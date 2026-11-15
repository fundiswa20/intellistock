namespace IntelliStock.Api.Models;

// UML: SupplierListing - one product on a supplier's price list
public class SupplierListing
{
    public int SupplierListingId { get; set; }
    public int SupplierId { get; set; }
    public string ProductName { get; set; } = "";
    public string Category { get; set; } = "";
    public int PackSize { get; set; }
    public decimal PackPrice { get; set; }
    public int LeadTimeDays { get; set; }
    // an inactive listing is hidden from owners but kept, because orders point at it
    public bool IsActive { get; set; } = true;
    public int AvailableQuantity { get; set; } = 0;   // in packs
    public decimal DeliveryCost { get; set; } = 0m;   // flat fee per order
    public DateTime UpdatedAt { get; set; }
}
