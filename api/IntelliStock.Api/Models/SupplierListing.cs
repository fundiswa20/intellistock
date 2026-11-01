namespace IntelliStock.Api.Models;

// UML: SupplierListing
public class SupplierListing
{
    public int SupplierListingId { get; set; }
    public int SupplierId { get; set; }
    public string ProductName { get; set; } = "";
    public string Category { get; set; } = "";
    public int PackSize { get; set; }
    public decimal PackPrice { get; set; }
    public int LeadTimeDays { get; set; }
    public bool IsActive { get; set; } = true;   // not redundant - without this a new listing is inactive
    public int AvailableQuantity { get; set; } = 0;
    public decimal DeliveryCost { get; set; } = 0m;
    public DateTime UpdatedAt { get; set; }
}
