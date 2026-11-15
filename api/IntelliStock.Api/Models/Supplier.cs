namespace IntelliStock.Api.Models;

// UML: Supplier - FR-06/FR-07: manages a price list and answers orders (D37)
public class Supplier : RegisteredUser
{
    public string CompanyName { get; set; } = "";
    public string? Phone { get; set; }
    public string? DeliveryArea { get; set; }
    // share of past orders delivered on time, 0 to 1
    public decimal ReliabilityScore { get; set; } = 0m;
}
