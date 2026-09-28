namespace IntelliStock.Api.Models;

// UML: SupplierListing - FR-06/FR-07 Partial: seeded, no interface
public class SupplierListing
{
    public int SupplierListingId { get; set; }
    public int SupplierId { get; set; }
    public string ProductName { get; set; } = "";
    public string Category { get; set; } = "";
    public int PackSize { get; set; }
    public decimal PackPrice { get; set; }
    public int LeadTimeDays { get; set; }
    public DateTime UpdatedAt { get; set; }
}
