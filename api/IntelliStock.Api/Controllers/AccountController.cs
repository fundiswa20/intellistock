using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using IntelliStock.Api.Data;
using IntelliStock.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Controllers;

public record AccountRequest(
    [Required, StringLength(120, MinimumLength = 2)] string FullName,
    [StringLength(20)] string? Phone,
    [StringLength(120)] string? BusinessName,
    [StringLength(120)] string? Location,
    [StringLength(120)] string? CompanyName,
    [StringLength(120)] string? DeliveryArea);

// The Settings screen: the signed-in user's own profile, for either role. Email and role
// are not editable - the email is the login, and a role change would orphan the data.
[ApiController]
[Route("api/account")]
[Authorize]
public class AccountController(InventoryRepository db) : ControllerBase
{
    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var user = await db.RegisteredUsers.SingleOrDefaultAsync(u => u.RegisteredUserId == UserId);
        return user is null ? NotFound() : Ok(View(user));
    }

    [HttpPut]
    public async Task<IActionResult> Update(AccountRequest req)
    {
        var user = await db.RegisteredUsers.SingleOrDefaultAsync(u => u.RegisteredUserId == UserId);
        if (user is null) return NotFound();

        var errors = new Dictionary<string, string[]>();
        if (user is BusinessOwner && string.IsNullOrWhiteSpace(req.BusinessName)) errors["businessName"] = ["Enter your shop's name."];
        if (user is BusinessOwner && string.IsNullOrWhiteSpace(req.Location)) errors["location"] = ["Enter where your shop is."];
        if (user is Supplier && string.IsNullOrWhiteSpace(req.CompanyName)) errors["companyName"] = ["Enter your company's name."];
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));

        user.FullName = req.FullName.Trim();
        switch (user)
        {
            case BusinessOwner o:
                o.BusinessName = req.BusinessName!.Trim();
                o.Location = req.Location!.Trim();
                o.Phone = Blank(req.Phone);
                break;
            case Supplier s:
                s.CompanyName = req.CompanyName!.Trim();
                s.DeliveryArea = Blank(req.DeliveryArea);
                s.Phone = Blank(req.Phone);
                break;
        }
        await db.SaveChangesAsync();
        return Ok(View(user));
    }

    private static object View(RegisteredUser u) => new
    {
        id = u.RegisteredUserId, u.FullName, u.Email, u.Role, u.CreatedAt,
        phone = (u as BusinessOwner)?.Phone ?? (u as Supplier)?.Phone,
        businessName = (u as BusinessOwner)?.BusinessName,
        location = (u as BusinessOwner)?.Location,
        companyName = (u as Supplier)?.CompanyName,
        deliveryArea = (u as Supplier)?.DeliveryArea,
        reliabilityScore = (u as Supplier)?.ReliabilityScore,
    };

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
