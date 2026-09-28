namespace IntelliStock.Api.Models;

// UML: Transaction - one stock movement. FR-04: immutable once written; the database
// rejects UPDATE and DELETE on this table (D19).
public class Transaction
{
    public long TransactionId { get; set; }
    public int StockItemId { get; set; }
    public string Type { get; set; } = "";          // Sale | Restock | Adjustment
    public int QuantityChange { get; set; }         // signed: a sale is negative
    public int QuantityAfter { get; set; }          // balance after this movement
    public DateTime OccurredAt { get; set; }
    public int RecordedByUserId { get; set; }
    public string? Note { get; set; }
}
