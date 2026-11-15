using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text;
using IntelliStock.Api.Data;
using IntelliStock.Api.Domain;
using IntelliStock.Api.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace IntelliStock.Api.Controllers;

public record LoginRequest([Required, EmailAddress] string Email, [Required] string Password);

// FR-01: one form for both roles; the role decides which of the optional fields are required
public record RegisterRequest(
    [Required] string Role,
    [Required, StringLength(120, MinimumLength = 2)] string FullName,
    [Required, EmailAddress, StringLength(255)] string Email,
    [Required, StringLength(128, MinimumLength = 8)] string Password,
    [StringLength(20)] string? Phone,
    [StringLength(120)] string? BusinessName,
    [StringLength(120)] string? Location,
    [StringLength(120)] string? CompanyName,
    [StringLength(120)] string? DeliveryArea);

// FR-01 registration and FR-02 login. Both answer with the same session: a JWT and the user.
[ApiController]
[Route("api/auth")]
public class AuthController(InventoryRepository db, IConfiguration config) : ControllerBase
{
    public const string Issuer = "intellistock-api";
    private static readonly PasswordHasher<RegisteredUser> Hasher = new();

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest req)
    {
        var user = await db.RegisteredUsers.SingleOrDefaultAsync(u => u.Email == req.Email.Trim().ToLower());

        // the same answer for an unknown email and a wrong password, so the response
        // does not reveal which email addresses are registered
        if (user is null || Hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password)
                == PasswordVerificationResult.Failed)
            return Unauthorized(new ProblemDetails { Title = "Email or password is incorrect.", Status = 401 });

        return Ok(Session(user));
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterRequest req)
    {
        var errors = new Dictionary<string, string[]>();
        if (req.Role is not ("BusinessOwner" or "Supplier"))
            errors["role"] = ["Choose whether you run a shop or supply shops."];
        if (req.Role == "BusinessOwner" && string.IsNullOrWhiteSpace(req.BusinessName))
            errors["businessName"] = ["Enter your shop's name."];
        if (req.Role == "BusinessOwner" && string.IsNullOrWhiteSpace(req.Location))
            errors["location"] = ["Enter where your shop is."];
        if (req.Role == "Supplier" && string.IsNullOrWhiteSpace(req.CompanyName))
            errors["companyName"] = ["Enter your company's name."];
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));

        var email = req.Email.Trim().ToLower();
        // registration has to say an email is taken; login still does not (see Login)
        if (await db.RegisteredUsers.AnyAsync(u => u.Email == email))
            return Conflict(new ProblemDetails { Title = "An account with this email already exists. Sign in instead.", Status = 409 });

        RegisteredUser user = req.Role == "BusinessOwner"
            ? new BusinessOwner
            {
                BusinessName = req.BusinessName!.Trim(), Location = req.Location!.Trim(), Phone = Blank(req.Phone),
            }
            : new Supplier
            {
                CompanyName = req.CompanyName!.Trim(), DeliveryArea = Blank(req.DeliveryArea), Phone = Blank(req.Phone),
            };
        user.Email = email;
        user.FullName = req.FullName.Trim();
        user.Role = req.Role;
        user.CreatedAt = Clock.Now;
        user.PasswordHash = Hasher.HashPassword(user, req.Password);

        db.RegisteredUsers.Add(user);
        await db.SaveChangesAsync();
        return StatusCode(201, Session(user));
    }

    private object Session(RegisteredUser user)
    {
        var hours = config.GetValue("Jwt:ExpiryHours", 8);
        var expires = DateTime.UtcNow.AddHours(hours);
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Issuer,
            Expires = expires,
            Subject = new ClaimsIdentity([
                new Claim(ClaimTypes.NameIdentifier, user.RegisteredUserId.ToString()),
                new Claim(ClaimTypes.Name, user.FullName),
                new Claim(ClaimTypes.Role, user.Role),
            ]),
            SigningCredentials = new SigningCredentials(SigningKey(config), SecurityAlgorithms.HmacSha256),
        });
        return new { token, expiresAt = expires, user = UserView(user) };
    }

    public static object UserView(RegisteredUser user) => new
    {
        id = user.RegisteredUserId, user.FullName, user.Email, user.Role,
        businessName = (user as BusinessOwner)?.BusinessName,
        companyName = (user as Supplier)?.CompanyName,
    };

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    public static SymmetricSecurityKey SigningKey(IConfiguration config)
    {
        var key = config["Jwt:Key"];
        if (string.IsNullOrEmpty(key) || Encoding.UTF8.GetByteCount(key) < 32)
            throw new InvalidOperationException("Jwt:Key must be set and at least 32 bytes long.");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key));
    }
}
