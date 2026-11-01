namespace IntelliStock.Api.DTOs;

public record  ListingResponse
{
    public int SupplierListingId {get; init;}
    public string ProductName {get; init;} = "";
    public string Category {get; init;} = "";
    public int PackSize {get; init;}
    public decimal PackPrice {get; init;}
    public int AvailableQuantity {get; init;}
    public int LeadTimeDays {get; init;}
    public decimal DeliveryCost {get; init;}
    public  bool IsActive {get; init;}
    public DateTime UpdatedAt{get; init;}
}
