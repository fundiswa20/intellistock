namespace IntelliStock.Api.Models;

// UML: Alert - FR-05 low-stock alert. Open while ResolvedAt is null (D21).
public class Alert
{
    public int AlertId { get; set; }
    public int StockItemId { get; set; }
    public string Type { get; set; } = "LowStock";
    public string Message { get; set; } = "";
    public int QuantityAtAlert { get; set; }
    public int ReorderLevel { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
}
