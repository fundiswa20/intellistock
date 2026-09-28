using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text;
using IntelliStock.Api.Data;
using IntelliStock.Api.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace IntelliStock.Api.Controllers;

public record LoginRequest([Required, EmailAddress] string Email, [Required] string Password);

// FR-02: login. Users are seeded - there is no registration endpoint (FR-01 Partial).
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

        var businessName = user is BusinessOwner owner ? owner.BusinessName : null;
        return Ok(new
        {
            token,
            expiresAt = expires,
            user = new { id = user.RegisteredUserId, user.FullName, user.Email, user.Role, businessName },
        });
    }

    public static SymmetricSecurityKey SigningKey(IConfiguration config)
    {
        var key = config["Jwt:Key"];
        if (string.IsNullOrEmpty(key) || Encoding.UTF8.GetByteCount(key) < 32)
            throw new InvalidOperationException("Jwt:Key must be set and at least 32 bytes long.");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key));
    }
}
