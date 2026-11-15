namespace IntelliStock.Api.Models;

// FR-10: an owner's order for whole packs of one supplier listing. Product, pack size and
// prices are copied from the listing when the order is placed (D37).
public class PurchaseOrder
{
    public int PurchaseOrderId { get; set; }
    public int BusinessOwnerId { get; set; }
    public int SupplierId { get; set; }
    public int SupplierListingId { get; set; }
    public int? StockItemId { get; set; }          // the owner's item a delivery is booked into
    public string ProductName { get; set; } = "";
    public int PackSize { get; set; }
    public decimal PackPrice { get; set; }
    public int Packs { get; set; }
    public decimal DeliveryCost { get; set; }
    public string Status { get; set; } = "Placed";
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public DateTime? DispatchedAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public DateTime? ClosedAt { get; set; }        // declined or cancelled
    public DateTime? ReceivedAt { get; set; }      // booked into stock by the owner
}
