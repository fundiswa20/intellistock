using IntelliStock.Api.Data;
using IntelliStock.Api.DTOs;
using IntelliStock.Api.Interfaces;
using IntelliStock.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Services;

public class SupplierService(InventoryRepository db) : ISupplierService
{
    // ---------- listings ----------

    public async Task<List<ListingResponse>> GetMyListingsAsync(int supplierId) =>
        await db.SupplierListings
            .Where(l => l.SupplierId == supplierId && l.IsActive)
            .OrderBy(l => l.ProductName)
            .Select(l => ToResponse(l))
            .ToListAsync();

    public async Task<ListingResponse?> GetListingAsync(int supplierId, int listingId)
    {
        var listing = await Find(supplierId, listingId);
        return listing is null ? null : ToResponse(listing);
    }

    public async Task<ListingResponse> CreateListingAsync(int supplierId, ListingRequest req)
    {
        var listing = new SupplierListing
        {
            SupplierId        = supplierId,
            ProductName       = req.ProductName.Trim(),
            Category          = req.Category.Trim(),
            PackSize          = req.PackSize,
            PackPrice         = req.PackPrice,
            AvailableQuantity = req.AvailableQuantity,
            LeadTimeDays      = req.LeadTimeDays,
            DeliveryCost      = req.DeliveryCost,
            IsActive          = true,
            UpdatedAt         = DateTime.UtcNow,
        };

        db.SupplierListings.Add(listing);
        await db.SaveChangesAsync();
        return ToResponse(listing);
    }

    public async Task<ListingResponse?> UpdateListingAsync(
        int supplierId, int listingId, ListingRequest req)
    {
        var listing = await Find(supplierId, listingId);
        if (listing is null) return null;

        listing.ProductName       = req.ProductName.Trim();
        listing.Category          = req.Category.Trim();
        listing.PackSize          = req.PackSize;
        listing.PackPrice         = req.PackPrice;
        listing.AvailableQuantity = req.AvailableQuantity;
        listing.LeadTimeDays      = req.LeadTimeDays;
        listing.DeliveryCost      = req.DeliveryCost;
        listing.UpdatedAt         = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return ToResponse(listing);
    }

    // withdraw, not delete: historical order lines still reference this listing
    public async Task<bool> WithdrawListingAsync(int supplierId, int listingId)
    {
        var listing = await Find(supplierId, listingId);
        if (listing is null) return false;

        listing.IsActive  = false;
        listing.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return true;
    }

    // ---------- incoming orders ----------

    public async Task<List<OrderResponse>> GetMyOrdersAsync(int supplierId) =>
    await db.Orders
        .Where(o => o.SupplierId == supplierId)
        .OrderByDescending(o => o.PlacedAt)
        .Select(o => new OrderResponse
        {
            OrderId = o.OrderId,
            CompanyName = db.BusinessOwners
                .Where(b => b.RegisteredUserId == o.BusinessOwnerId)
                .Select(b => b.BusinessName)
                .FirstOrDefault() ?? "",
            Status = o.Status,
            TotalCost = o.TotalCost,
            PlacedAt = o.PlacedAt,
            ExpectedDeliveryAt = o.ExpectedDeliveryAt,
            Lines = db.OrderLines
                .Where(line => line.OrderId == o.OrderId)
                .Select(line => new OrderLineResponse
                {
                    OrderLineId = line.OrderLineId,
                    ProductName = db.SupplierListings
                        .Where(l => l.SupplierListingId == line.SupplierListingId)
                        .Select(l => l.ProductName)
                        .FirstOrDefault() ?? "",
                    Quantity = line.Quantity,
                    UnitPrice = line.UnitPrice,
                    LineTotal = line.LineTotal
                })
                .ToList()
        })
        .ToListAsync();

    public async Task<OrderResponse?> UpdateOrderStatusAsync(
        int supplierId, int orderId, string status)
    {
        var order = await db.Orders
            .SingleOrDefaultAsync(o => o.OrderId == orderId && o.SupplierId == supplierId);
        if (order is null) return null;

        if (!IsValidTransition(order.Status, status)) return null;

        order.Status = status;
        if (status == "Delivered") order.DeliveredAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return (await GetMyOrdersAsync(supplierId))
            .SingleOrDefault(o => o.OrderId == orderId);
    }

    // ---------- helpers ----------

    private Task<SupplierListing?> Find(int supplierId, int listingId) =>
        db.SupplierListings.SingleOrDefaultAsync(
            l => l.SupplierListingId == listingId && l.SupplierId == supplierId);

    private static bool IsValidTransition(string from, string to) => (from, to) switch
    {
        ("Placed", "Confirmed")      => true,
        ("Confirmed", "Dispatched")  => true,
        ("Dispatched", "Delivered")  => true,
        _ => false,
    };

    private static ListingResponse ToResponse(SupplierListing l) => new()
{
    SupplierListingId = l.SupplierListingId,
    ProductName = l.ProductName,
    Category = l.Category,
    PackSize = l.PackSize,
    PackPrice = l.PackPrice,
    AvailableQuantity = l.AvailableQuantity,
    LeadTimeDays = l.LeadTimeDays,
    DeliveryCost = l.DeliveryCost,
    IsActive = l.IsActive,
    UpdatedAt = l.UpdatedAt
};
}