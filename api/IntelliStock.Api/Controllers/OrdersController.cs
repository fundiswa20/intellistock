using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using IntelliStock.Api.Data;
using IntelliStock.Api.Domain;
using IntelliStock.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Controllers;

public record PlaceOrderRequest(
    int SupplierListingId,
    [Range(1, 1000)] int Packs,
    int? StockItemId,
    [StringLength(255)] string? Note);

public record ReceiveOrderRequest(int? StockItemId);

// FR-06 (browse supplier listings) and FR-10 (place and track orders), for the owner (D37).
// Like stock, another owner's order answers 404 (D28).
[ApiController]
[Authorize(Roles = "BusinessOwner")]
public class OrdersController(InventoryRepository db) : ControllerBase
{
    private int OwnerId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // ------------------------------------------------------------------ FR-06 browse listings

    // every active listing from every supplier, cheapest per unit first within a product
    [HttpGet("api/listings")]
    public async Task<IActionResult> Listings([FromQuery] string? q)
    {
        var query = from l in db.SupplierListings
                    join s in db.Suppliers on l.SupplierId equals s.RegisteredUserId
                    where l.IsActive
                    select new { l, s };
        if (!string.IsNullOrWhiteSpace(q))
            query = query.Where(x => x.l.ProductName.Contains(q.Trim()) || x.s.CompanyName.Contains(q.Trim()));
        var rows = await query.ToListAsync();
        return Ok(rows
            .OrderBy(x => x.l.ProductName).ThenBy(x => x.l.PackPrice / x.l.PackSize)
            .Select(x => new
            {
                x.l.SupplierListingId, x.l.SupplierId, supplierName = x.s.CompanyName, x.s.DeliveryArea,
                x.s.ReliabilityScore, x.l.ProductName, x.l.Category, x.l.PackSize, x.l.PackPrice,
                unitPrice = Math.Round(x.l.PackPrice / x.l.PackSize, 2),
                x.l.LeadTimeDays, x.l.AvailableQuantity, x.l.DeliveryCost, x.l.UpdatedAt,
            }));
    }

    // ------------------------------------------------------------------ FR-10 orders

    [HttpGet("api/orders")]
    public async Task<IActionResult> List() =>
        Ok((await MyOrders().ToListAsync())
            .OrderByDescending(x => x.o.CreatedAt).ThenByDescending(x => x.o.PurchaseOrderId)
            .Select(x => OrderViews.View(x.o, x.s, null)));

    [HttpGet("api/orders/{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var x = await MyOrders(id).SingleOrDefaultAsync();
        return x is null ? NotFound() : Ok(OrderViews.View(x.o, x.s, null));
    }

    [HttpPost("api/orders")]
    public async Task<IActionResult> Place(PlaceOrderRequest req)
    {
        await using var tx = await db.Database.BeginTransactionAsync();

        // lock the listing so two orders cannot both take the last packs
        var listing = await db.SupplierListings
            .FromSqlInterpolated($"SELECT * FROM SupplierListing WHERE SupplierListingId = {req.SupplierListingId} FOR UPDATE")
            .SingleOrDefaultAsync();
        if (listing is null || !listing.IsActive)
            return NotFound(new ProblemDetails { Title = "That listing is no longer available.", Status = 404 });
        if (req.Packs > listing.AvailableQuantity)
            return Conflict(new ProblemDetails
            {
                Title = listing.AvailableQuantity == 0
                    ? "The supplier has none of this in stock right now."
                    : $"The supplier has only {listing.AvailableQuantity} {(listing.AvailableQuantity == 1 ? "pack" : "packs")} available.",
                Status = 409,
            });
        if (req.StockItemId is { } itemId && !await MyItem(itemId).AnyAsync())
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["stockItemId"] = ["That stock item does not exist."],
            }));

        var supplier = await db.Suppliers.SingleAsync(s => s.RegisteredUserId == listing.SupplierId);
        listing.AvailableQuantity -= req.Packs;
        var order = new PurchaseOrder
        {
            BusinessOwnerId = OwnerId,
            SupplierId = listing.SupplierId,
            SupplierListingId = listing.SupplierListingId,
            StockItemId = req.StockItemId,
            ProductName = listing.ProductName,
            PackSize = listing.PackSize,
            PackPrice = listing.PackPrice,
            Packs = req.Packs,
            DeliveryCost = listing.DeliveryCost,
            Status = "Placed",
            Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim(),
            CreatedAt = Clock.Now,
        };
        db.PurchaseOrders.Add(order);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return CreatedAtAction(nameof(Get), new { id = order.PurchaseOrderId }, OrderViews.View(order, supplier, null));
    }

    [HttpPost("api/orders/{id:int}/cancel")]
    public async Task<IActionResult> Cancel(int id)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var order = await OrderViews.Lock(db, id);
        if (order is null || order.BusinessOwnerId != OwnerId) return NotFound();
        if (!OrderRules.OwnerCanCancel(order.Status))
            return Conflict(new ProblemDetails
            {
                Title = $"This order is {order.Status.ToLower()}; only an order the supplier has not confirmed can be cancelled.",
                Status = 409,
            });

        order.Status = "Cancelled";
        order.ClosedAt = Clock.Now;
        await OrderViews.ReturnPacks(db, order);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        var supplier = await db.Suppliers.SingleAsync(s => s.RegisteredUserId == order.SupplierId);
        return Ok(OrderViews.View(order, supplier, null));
    }

    // books a delivered order into stock as one Restock movement (FR-04), once
    [HttpPost("api/orders/{id:int}/receive")]
    public async Task<IActionResult> Receive(int id, ReceiveOrderRequest? req)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var order = await OrderViews.Lock(db, id);
        if (order is null || order.BusinessOwnerId != OwnerId) return NotFound();
        if (order.Status != "Delivered")
            return Conflict(new ProblemDetails { Title = "Only a delivered order can be received into stock.", Status = 409 });
        if (order.ReceivedAt is not null)
            return Conflict(new ProblemDetails { Title = "This order has already been received into stock.", Status = 409 });

        var itemId = req?.StockItemId ?? order.StockItemId;
        if (itemId is null)
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["stockItemId"] = ["Choose which stock item this delivery is for."],
            }));
        var item = await StockLedger.LockItem(db, itemId.Value);
        if (item is null || item.BusinessOwnerId != OwnerId || !item.IsActive)
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["stockItemId"] = ["That stock item does not exist."],
            }));

        var supplier = await db.Suppliers.SingleAsync(s => s.RegisteredUserId == order.SupplierId);
        var now = Clock.Now;
        var (_, alert) = await StockLedger.ApplyMovement(db, item, "Restock", order.Packs * order.PackSize,
            $"Order #{order.PurchaseOrderId} from {supplier.CompanyName}", now, OwnerId);
        order.StockItemId = item.StockItemId;
        order.ReceivedAt = now;
        await db.SaveChangesAsync();
        await tx.CommitAsync();

        return Ok(new
        {
            order = OrderViews.View(order, supplier, null),
            quantityOnHand = item.QuantityOnHand,
            alert = alert == StockRules.AlertAction.Resolve ? "resolved" : null,
        });
    }

    private IQueryable<StockItem> MyItem(int id) =>
        db.StockItems.Where(s => s.StockItemId == id && s.BusinessOwnerId == OwnerId && s.IsActive);

    // filter before projecting: EF cannot translate a filter on the projected record
    private IQueryable<OrderRow> MyOrders(int? id = null) =>
        from o in db.PurchaseOrders
        join s in db.Suppliers on o.SupplierId equals s.RegisteredUserId
        where o.BusinessOwnerId == OwnerId && (id == null || o.PurchaseOrderId == id)
        select new OrderRow(o, s);

    private record OrderRow(PurchaseOrder o, Supplier s);
}

// the one shape an order is shown in, to the owner and to the supplier
public static class OrderViews
{
    public static object View(PurchaseOrder o, Supplier s, BusinessOwner? owner) => new
    {
        o.PurchaseOrderId, o.Status, o.ProductName, o.PackSize, o.PackPrice, o.Packs,
        units = o.Packs * o.PackSize,
        subtotal = o.Packs * o.PackPrice,
        o.DeliveryCost,
        total = OrderRules.Total(o.Packs, o.PackPrice, o.DeliveryCost),
        o.Note, o.StockItemId, o.SupplierListingId,
        supplier = new { id = s.RegisteredUserId, name = s.CompanyName, s.Phone, s.DeliveryArea, s.ReliabilityScore },
        owner = owner is null ? null : new
        {
            id = owner.RegisteredUserId, name = owner.BusinessName, contact = owner.FullName, owner.Location, owner.Phone,
        },
        o.CreatedAt, o.ConfirmedAt, o.DispatchedAt, o.DeliveredAt, o.ClosedAt, o.ReceivedAt,
        nextStatuses = OrderRules.SupplierNext(o.Status),
        canCancel = OrderRules.OwnerCanCancel(o.Status),
        canReceive = o.Status == "Delivered" && o.ReceivedAt is null,
    };

    // lock the order row: a supplier's status change and an owner's cancel cannot interleave
    public static Task<PurchaseOrder?> Lock(InventoryRepository db, int id) =>
        db.PurchaseOrders.FromSqlInterpolated($"SELECT * FROM PurchaseOrder WHERE PurchaseOrderId = {id} FOR UPDATE")
            .SingleOrDefaultAsync();

    public static async Task ReturnPacks(InventoryRepository db, PurchaseOrder order)
    {
        var listing = await db.SupplierListings
            .FromSqlInterpolated($"SELECT * FROM SupplierListing WHERE SupplierListingId = {order.SupplierListingId} FOR UPDATE")
            .SingleAsync();
        listing.AvailableQuantity += order.Packs;
    }
}
