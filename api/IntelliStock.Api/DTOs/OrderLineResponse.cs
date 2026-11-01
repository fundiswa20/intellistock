namespace IntelliStock.Api.DTOs;

public record OrderLineResponse
{
    public int OrderLineId{get;init;}
    public string ProductName{get;init;} = "";
    public int Quantity{get;init;}
    public decimal UnitPrice{get;init;}
    public decimal LineTotal{get; init;}
}
