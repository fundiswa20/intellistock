namespace IntelliStock.Api.Models;

// UML: StockItem
public class StockItem
{
    public int StockItemId { get; set; }
    public int BusinessOwnerId { get; set; }
    public string Name { get; set; } = "";
    public string Category { get; set; } = "Groceries";
    public string Unit { get; set; } = "each";
    // changed only by recording a Transaction (FR-04), never edited directly
    public int QuantityOnHand { get; set; }
    public int ReorderLevel { get; set; }
    public decimal UnitCost { get; set; }
    public decimal SellingPrice { get; set; }
    // FR-03: delete is a soft delete (D20)
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
}
