namespace IntelliStock.Api.Models;

// UML: BusinessOwner - the spaza-shop owner who uses the InventoryDashboard
public class BusinessOwner : RegisteredUser
{
    public string BusinessName { get; set; } = "";
    public string Location { get; set; } = "";
    public string? Phone { get; set; }
}
