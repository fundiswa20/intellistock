using System;

namespace IntelliStock.Api.Models;

public class OrderLine
{
    public int OrderLineId {get; set;}
    public int OrderId {get;set;}
    public int SupplierListingId {get;set;}
    public int StockItemId {get; set;}
    public int Quantity {get; set;}
    public decimal UnitPrice{get; set;}
    public decimal LineTotal {get;set;}
}
