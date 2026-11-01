namespace IntelliStock.Api.DTOs;

public record ListingRequest
{
    public string ProductName { get; init; } = "";
    public string Category { get; init; } = "";
    public int PackSize { get; init; }
    public decimal PackPrice { get; init; }
    public int AvailableQuantity { get; init; }
    public int LeadTimeDays { get; init; }
    public decimal DeliveryCost { get; init; }
}
