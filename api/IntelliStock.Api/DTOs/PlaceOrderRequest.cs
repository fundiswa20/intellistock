namespace IntelliStock.Api.DTOs;

public record PlaceOrderRequest
{
    public int SupplierListingId{get;init;}
    public int StockItemId{get; init;}
    public int Quantity{get; init;}
    
}
