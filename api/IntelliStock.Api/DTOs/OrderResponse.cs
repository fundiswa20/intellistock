

namespace IntelliStock.Api.DTOs;

public record OrderResponse
{
    public int OrderId{get;init;}
    public string CompanyName{get;init;} ="";
    public string Status {get; init;} ="";
    public decimal TotalCost{get; init;}
    public DateTime PlacedAt {get; init;}

    public DateTime? ExpectedDeliveryAt{get;init;}
    public List<OrderLineResponse> Lines{get;init;} = [];

}
