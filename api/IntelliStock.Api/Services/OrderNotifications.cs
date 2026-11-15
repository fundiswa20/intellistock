using IntelliStock.Api.Data;
using IntelliStock.Api.Domain;
using IntelliStock.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Services;

// D40: the email sent for each order status change (FR-10).
//   Placed                          -> the supplier
//   Confirmed, Dispatched, Delivered -> the owner
//   Declined                        -> the owner        Cancelled -> the supplier
// Called after the change is committed. A failed send is logged and swallowed: the order
// has already succeeded and the API answers as normal.
public class OrderNotifications(InventoryRepository db, IEmailService email, ILogger<OrderNotifications> log)
{
    public Task Placed(PurchaseOrder o, BusinessOwner owner, Supplier supplier) => Send(o, "placed", () =>
    {
        var (html, text) = EmailTemplate.Render(
            $"New order #{o.PurchaseOrderId}",
            $"{owner.BusinessName} has placed an order with {supplier.CompanyName}. Please confirm or decline it in IntelliStock.",
            [
                ("Order", $"#{o.PurchaseOrderId}"),
                ("Ordered by", $"{owner.BusinessName} ({owner.FullName})"),
                ("Deliver to", owner.Location),
                ("Phone", owner.Phone ?? ""),
                ("Product", o.ProductName),
                ("Quantity", $"{o.Packs} {(o.Packs == 1 ? "pack" : "packs")} of {o.PackSize} ({o.Packs * o.PackSize} units)"),
                ("Total", EmailTemplate.Money(OrderRules.Total(o.Packs, o.PackPrice, o.DeliveryCost))),
                ("Note", o.Note ?? ""),
            ]);
        return Task.FromResult(new EmailMessage(supplier.Email, $"New order #{o.PurchaseOrderId} from {owner.BusinessName}: {o.ProductName}", html, text));
    });

    public Task StatusChanged(PurchaseOrder o, BusinessOwner owner, Supplier supplier, string? reason = null) =>
        Send(o, o.Status.ToLowerInvariant(), async () =>
        {
            var status = o.Status.ToLowerInvariant();
            if (o.Status == "Cancelled")
            {
                var (h, t) = EmailTemplate.Render(
                    $"Order #{o.PurchaseOrderId} was cancelled",
                    $"{owner.BusinessName} cancelled this order. The packs are back on your listing.",
                    [
                        ("Order", $"#{o.PurchaseOrderId}"), ("Shop", owner.BusinessName), ("Product", o.ProductName),
                        ("Quantity", $"{o.Packs} {(o.Packs == 1 ? "pack" : "packs")} of {o.PackSize}"),
                        ("New status", "Cancelled"), ("Reason", reason ?? ""),
                    ]);
                return new EmailMessage(supplier.Email, $"Order #{o.PurchaseOrderId} cancelled: {o.ProductName}", h, t);
            }

            var expected = o.Status switch
            {
                "Delivered" => $"Delivered {EmailTemplate.Date(o.DeliveredAt ?? Clock.Now)}",
                "Declined" => "",
                _ => await ExpectedDelivery(o),
            };
            var intro = o.Status switch
            {
                "Confirmed" => $"{supplier.CompanyName} has confirmed your order.",
                "Dispatched" => $"{supplier.CompanyName} has dispatched your order. It is on its way.",
                "Delivered" => $"{supplier.CompanyName} has marked your order delivered. Receive it into stock in IntelliStock once you have checked the goods.",
                "Declined" => $"{supplier.CompanyName} has declined your order. You can order from another supplier from the item's page.",
                _ => $"Your order is now {status}.",
            };
            var (html, text) = EmailTemplate.Render(
                $"Order #{o.PurchaseOrderId} {status}", intro,
                [
                    ("Order", $"#{o.PurchaseOrderId}"), ("Product", o.ProductName),
                    ("Quantity", $"{o.Packs} {(o.Packs == 1 ? "pack" : "packs")} of {o.PackSize} ({o.Packs * o.PackSize} units)"),
                    ("Supplier", supplier.CompanyName), ("New status", o.Status),
                    ("Expected delivery", expected), ("Reason", reason ?? ""),
                    ("Total", EmailTemplate.Money(OrderRules.Total(o.Packs, o.PackPrice, o.DeliveryCost))),
                ]);
            return new EmailMessage(owner.Email, $"Order #{o.PurchaseOrderId} {status}: {o.ProductName}", html, text);
        });

    // confirmed (or placed) date plus the listing's lead time
    private async Task<string> ExpectedDelivery(PurchaseOrder o)
    {
        var lead = await db.SupplierListings.Where(l => l.SupplierListingId == o.SupplierListingId)
            .Select(l => (int?)l.LeadTimeDays).SingleOrDefaultAsync();
        if (lead is null) return "";
        var from = (o.ConfirmedAt ?? o.CreatedAt).Date;
        return $"By {EmailTemplate.Date(from.AddDays(lead.Value))} ({lead} {(lead == 1 ? "day" : "days")} lead time)";
    }

    private async Task Send(PurchaseOrder o, string what, Func<Task<EmailMessage>> build)
    {
        try
        {
            var message = await build();
            await email.SendAsync(message);
            log.LogInformation("Order {OrderId} {What} email sent to {To}", o.PurchaseOrderId, what, message.To);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Order {OrderId} {What} email could not be sent; the order is unaffected", o.PurchaseOrderId, what);
        }
    }
}
