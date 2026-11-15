using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using IntelliStock.Api.Data;
using IntelliStock.Api.Domain;
using IntelliStock.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Controllers;

public record ListingRequest(
    [Required, StringLength(120, MinimumLength = 2)] string ProductName,
    [Required] string Category,
    [Range(1, 10_000)] int PackSize,
    [Range(0, 1_000_000)] decimal PackPrice,
    [Range(0, 60)] int LeadTimeDays,
    [Range(0, 100_000)] int AvailableQuantity,
    [Range(0, 100_000)] decimal DeliveryCost,
    bool IsActive = true);

public record OrderStatusRequest([Required] string Status);

// FR-06 / FR-07: the supplier's own price list and the orders placed with them (D37).
// Every query is scoped to the signed-in supplier; anyone else's listing or order is 404.
[ApiController]
[Route("api/supplier")]
[Authorize(Roles = "Supplier")]
public class SupplierController(InventoryRepository db) : ControllerBase
{
    private int SupplierId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // ------------------------------------------------------------------ listings

    [HttpGet("listings")]
    public async Task<IActionResult> Listings() =>
        Ok((await db.SupplierListings.Where(l => l.SupplierId == SupplierId).OrderBy(l => l.ProductName).ToListAsync())
            .Select(ListingView));

    [HttpPost("listings")]
    public async Task<IActionResult> CreateListing(ListingRequest req)
    {
        if (CategoryError(req.Category) is { } error) return error;
        var listing = new SupplierListing { SupplierId = SupplierId };
        Apply(listing, req);
        db.SupplierListings.Add(listing);
        await db.SaveChangesAsync();
        return StatusCode(201, ListingView(listing));
    }

    [HttpPut("listings/{id:int}")]
    public async Task<IActionResult> UpdateListing(int id, ListingRequest req)
    {
        if (CategoryError(req.Category) is { } error) return error;
        var listing = await db.SupplierListings.SingleOrDefaultAsync(l => l.SupplierListingId == id && l.SupplierId == SupplierId);
        if (listing is null) return NotFound();
        Apply(listing, req);   // orders already placed keep the price they were placed at
        await db.SaveChangesAsync();
        return Ok(ListingView(listing));
    }

    // ------------------------------------------------------------------ orders

    [HttpGet("orders")]
    public async Task<IActionResult> Orders()
    {
        var supplier = await Me();
        var rows = await (from o in db.PurchaseOrders
                          join w in db.BusinessOwners on o.BusinessOwnerId equals w.RegisteredUserId
                          where o.SupplierId == SupplierId
                          orderby o.CreatedAt descending, o.PurchaseOrderId descending
                          select new { o, w }).ToListAsync();
        return Ok(rows.Select(r => OrderViews.View(r.o, supplier, r.w)));
    }

    [HttpGet("orders/{id:int}")]
    public async Task<IActionResult> Order(int id)
    {
        var order = await db.PurchaseOrders.SingleOrDefaultAsync(o => o.PurchaseOrderId == id && o.SupplierId == SupplierId);
        if (order is null) return NotFound();
        var owner = await db.BusinessOwners.SingleAsync(w => w.RegisteredUserId == order.BusinessOwnerId);
        return Ok(OrderViews.View(order, await Me(), owner));
    }

    [HttpPost("orders/{id:int}/status")]
    public async Task<IActionResult> SetStatus(int id, OrderStatusRequest req)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var order = await OrderViews.Lock(db, id);
        if (order is null || order.SupplierId != SupplierId) return NotFound();
        if (OrderRules.SupplierMoveError(order.Status, req.Status) is { } error)
            return Conflict(new ProblemDetails { Title = error, Status = 409 });

        var now = Clock.Now;
        order.Status = req.Status;
        switch (req.Status)
        {
            case "Confirmed": order.ConfirmedAt = now; break;
            case "Dispatched": order.DispatchedAt = now; break;
            case "Delivered": order.DeliveredAt = now; break;
            case "Declined": order.ClosedAt = now; break;
        }
        if (OrderRules.ReturnsStock(req.Status)) await OrderViews.ReturnPacks(db, order);
        await db.SaveChangesAsync();
        await tx.CommitAsync();

        var owner = await db.BusinessOwners.SingleAsync(w => w.RegisteredUserId == order.BusinessOwnerId);
        return Ok(OrderViews.View(order, await Me(), owner));
    }

    // ------------------------------------------------------------------ helpers

    private Task<Supplier> Me() => db.Suppliers.SingleAsync(s => s.RegisteredUserId == SupplierId);

    private static void Apply(SupplierListing l, ListingRequest req)
    {
        l.ProductName = req.ProductName.Trim();
        l.Category = req.Category;
        l.PackSize = req.PackSize;
        l.PackPrice = req.PackPrice;
        l.LeadTimeDays = req.LeadTimeDays;
        l.AvailableQuantity = req.AvailableQuantity;
        l.DeliveryCost = req.DeliveryCost;
        l.IsActive = req.IsActive;
        l.UpdatedAt = Clock.Now;
    }

    private IActionResult? CategoryError(string category) =>
        StockRules.Categories.Contains(category)
            ? null
            : ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["category"] = [$"Category must be one of: {string.Join(", ", StockRules.Categories)}."],
            }));

    private static object ListingView(SupplierListing l) => new
    {
        l.SupplierListingId, l.ProductName, l.Category, l.PackSize, l.PackPrice,
        unitPrice = Math.Round(l.PackPrice / l.PackSize, 2),
        l.LeadTimeDays, l.AvailableQuantity, l.DeliveryCost, l.IsActive, l.UpdatedAt,
    };
}
