namespace IntelliStock.Api.Models;

// UML: RegisteredUser - base class of BusinessOwner and Supplier (table-per-type, D18)
public abstract class RegisteredUser
{
    public int RegisteredUserId { get; set; }
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string FullName { get; set; } = "";
    public string Role { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}
