using IntelliStock.Api.Data;
using IntelliStock.Api.Domain;
using IntelliStock.Api.DTOs;
using IntelliStock.Api.Interfaces;
using IntelliStock.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Services;

public class OrderService(InventoryRepository db) : IOrderService
{
    public async Task<OrderResponse> PlaceOrderAsync(
        int businessOwnerId, PlaceOrderRequest req)
    {
        var listing = await db.SupplierListings.SingleOrDefaultAsync(
            l => l.SupplierListingId == req.SupplierListingId && l.IsActive)
            ?? throw new InvalidOperationException("Listing not found or no longer active.");

        var packs = SupplierScoring.PacksRequired(req.Quantity, listing.PackSize);
        var total = SupplierScoring.TotalDeliveredCost(
            req.Quantity, listing.PackSize, listing.PackPrice, listing.DeliveryCost);

        var order = new Order
        {
            BusinessOwnerId    = businessOwnerId,
            SupplierId         = listing.SupplierId,
            Status             = "Placed",
            TotalCost          = total,
            PlacedAt           = DateTime.UtcNow,
            ExpectedDeliveryAt = DateTime.UtcNow.AddDays(listing.LeadTimeDays),
        };
        db.Orders.Add(order);
        await db.SaveChangesAsync();

        db.OrderLines.Add(new OrderLine
        {
            OrderId           = order.OrderId,
            SupplierListingId = listing.SupplierListingId,
            StockItemId       = req.StockItemId,
            Quantity          = packs * listing.PackSize,
            UnitPrice         = listing.PackPrice,   // price at the time of order
            LineTotal         = packs * listing.PackPrice,
        });
        await db.SaveChangesAsync();

        return (await GetOrderAsync(businessOwnerId, order.OrderId))!;
    }

    public async Task<List<OrderResponse>> GetMyOrdersAsync(int businessOwnerId) =>
        await Query(o => o.BusinessOwnerId == businessOwnerId).ToListAsync();

    public async Task<OrderResponse?> GetOrderAsync(int businessOwnerId, int orderId) =>
        await Query(o => o.BusinessOwnerId == businessOwnerId && o.OrderId == orderId)
            .SingleOrDefaultAsync();

    private IQueryable<OrderResponse> Query(
        System.Linq.Expressions.Expression<Func<Order, bool>> where) =>
        db.Orders
            .Where(where)
            .OrderByDescending(o => o.PlacedAt)
            .Select(o => new OrderResponse
            {
                OrderId            = o.OrderId,
                CompanyName        = db.Suppliers
                                       .Where(s => s.RegisteredUserId == o.SupplierId)
                                       .Select(s => s.CompanyName).First(),
                Status             = o.Status,
                TotalCost          = o.TotalCost,
                PlacedAt           = o.PlacedAt,
                ExpectedDeliveryAt = o.ExpectedDeliveryAt,
                Lines              = db.OrderLines
                    .Where(line => line.OrderId == o.OrderId)
                    .Select(line => new OrderLineResponse
                    {
                        OrderLineId = line.OrderLineId,
                        ProductName = db.SupplierListings
                                        .Where(l => l.SupplierListingId == line.SupplierListingId)
                                        .Select(l => l.ProductName).First(),
                        Quantity    = line.Quantity,
                        UnitPrice   = line.UnitPrice,
                        LineTotal   = line.LineTotal,
                    })
                    .ToList(),
            });
}