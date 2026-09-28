namespace IntelliStock.Api.Models;

// UML: Supplier - FR-06/FR-07 Partial: seeded, no supplier interface
public class Supplier : RegisteredUser
{
    public string CompanyName { get; set; } = "";
    public string? Phone { get; set; }
    public string? DeliveryArea { get; set; }
}
