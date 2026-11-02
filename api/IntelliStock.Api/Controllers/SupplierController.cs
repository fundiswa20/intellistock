using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using IntelliStock.Api.DTOs;
using IntelliStock.Api.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace IntelliStock.Api.Controllers;

// Supplier side - FR-06. Every route is scoped to the signed-in supplier, so another
// supplier's listing returns 404 rather than 403 (same rule as StockController).
[ApiController]
[Route("api/supplier")]
[Authorize(Roles = "Supplier")]
public class SupplierController : ControllerBase
{
    private readonly ISupplierService suppliers;

    public SupplierController(ISupplierService suppliers)
    {
        this.suppliers = suppliers;
    }

    private int SupplierId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("listings")]
    public async Task<IActionResult> GetListings()
        => Ok(await suppliers.GetMyListingsAsync(SupplierId));

    [HttpGet("listings/{id:int}")]
    public async Task<IActionResult> GetListing(int id)
    {
        var listing = await suppliers.GetListingAsync(SupplierId, id);
        return listing is null ? NotFound() : Ok(listing);
    }

    [HttpPost("listings")]
    public async Task<IActionResult> CreateListing(ListingRequest req)
    {
        var created = await suppliers.CreateListingAsync(SupplierId, req);
        return CreatedAtAction(nameof(GetListing),
            new { id = created.SupplierListingId }, created);
    }

    [HttpPut("listings/{id:int}")]
    public async Task<IActionResult> UpdateListing(int id, ListingRequest req)
    {
        var updated = await suppliers.UpdateListingAsync(SupplierId, id, req);
        return updated is null ? NotFound() : Ok(updated);
    }

    // withdraw, not delete - historical order lines still reference this listing
    [HttpDelete("listings/{id:int}")]
    public async Task<IActionResult> WithdrawListing(int id)
        => await suppliers.WithdrawListingAsync(SupplierId, id) ? NoContent() : NotFound();

    [HttpGet("orders")]
    public async Task<IActionResult> GetOrders()
        => Ok(await suppliers.GetMyOrdersAsync(SupplierId));

    [HttpPut("orders/{id:int}/status")]
    public async Task<IActionResult> UpdateOrderStatus(int id, StatusUpdateRequest req)
    {
        var updated = await suppliers.UpdateOrderStatusAsync(SupplierId, id, req.Status);
        return updated is null ? NotFound() : Ok(updated);
    }
}

public record StatusUpdateRequest(
    [Required, RegularExpression("Confirmed|Dispatched|Delivered")] string Status);