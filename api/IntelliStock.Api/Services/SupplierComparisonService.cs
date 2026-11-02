using IntelliStock.Api.Data;
using IntelliStock.Api.Domain;
using IntelliStock.Api.DTOs;
using IntelliStock.Api.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Services;

public class SupplierComparisonService(InventoryRepository db) : ISupplierComparisonService
{
    public async Task<List<SupplierOptionResponse>> CompareAsync(
        int businessOwnerId, int stockItemId, int quantity)
    {
        // the item must belong to this owner - otherwise return nothing
        var item = await db.StockItems.SingleOrDefaultAsync(
            s => s.StockItemId == stockItemId && s.BusinessOwnerId == businessOwnerId);
        if (item is null) return [];

        var owner = await db.BusinessOwners.SingleAsync(
            b => b.RegisteredUserId == businessOwnerId);

        // match on product name, case-insensitively. A real system would need a shared
        // product catalogue; this is a documented prototype limitation.
        var listings = await db.SupplierListings
            .Where(l => l.IsActive
                     && l.AvailableQuantity >= quantity
                     && l.ProductName.ToLower() == item.Name.ToLower())
            .Join(db.Suppliers,
                  l => l.SupplierId,
                  s => s.RegisteredUserId,
                  (l, s) => new { Listing = l, Supplier = s })
            .ToListAsync();

        if (listings.Count == 0) return [];

        var priced = listings.Select(x => new
        {
            x.Listing,
            x.Supplier,
            Packs = SupplierScoring.PacksRequired(quantity, x.Listing.PackSize),
            Cost  = SupplierScoring.TotalDeliveredCost(
                        quantity, x.Listing.PackSize, x.Listing.PackPrice, x.Listing.DeliveryCost),
            ServesMyArea = !string.IsNullOrWhiteSpace(x.Supplier.DeliveryArea)
                        && !string.IsNullOrWhiteSpace(owner.Location)
                        && x.Supplier.DeliveryArea.Contains(
                               owner.Location.Split(',')[0].Trim(),
                               StringComparison.OrdinalIgnoreCase),
        }).ToList();

        var cheapest = priced.Min(p => p.Cost);
        var fastest  = priced.Min(p => p.Listing.LeadTimeDays);

       var options = priced.Select(p => new SupplierOptionResponse
        {
            SupplierListingId  = p.Listing.SupplierListingId,
            SupplierId         = p.Supplier.RegisteredUserId,
            CompanyName        = p.Supplier.CompanyName,
            DeliveryArea       = p.Supplier.DeliveryArea ?? "",
            PackPrice          = p.Listing.PackPrice,
            PackSize           = p.Listing.PackSize,
            PacksRequired      = p.Packs,
            DeliveryCost       = p.Listing.DeliveryCost,
            TotalDeliveredCost = p.Cost,
            LeadTimeDays       = p.Listing.LeadTimeDays,
            ReliabilityScore   = p.Supplier.ReliabilityScore,
            ServesMyArea       = p.ServesMyArea,
            Score              = SupplierScoring.Score(p.Cost, cheapest, p.Listing.LeadTimeDays,
                                                    fastest, p.Supplier.ReliabilityScore, p.ServesMyArea),
            IsRecommended      = false,
            ScoreBreakdown     = SupplierScoring.Breakdown(p.Cost, p.Listing.LeadTimeDays,
                                                        p.Supplier.ReliabilityScore, p.ServesMyArea),
        })
        .OrderBy(o => o.TotalDeliveredCost)
        .ToList();

        // flag the highest-scoring option as recommended
        var best = options.MaxBy(o => o.Score)!;
        return options
            .Select(o => o.SupplierListingId == best.SupplierListingId
                ? o with { IsRecommended = true }
                : o)
            .ToList();
    }
}