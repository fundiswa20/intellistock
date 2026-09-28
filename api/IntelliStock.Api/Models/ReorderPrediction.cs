namespace IntelliStock.Api.Models;

// UML: ReorderPrediction - FR-08. Every prediction shown to the owner is stored.
public class ReorderPrediction
{
    public int ReorderPredictionId { get; set; }
    public int StockItemId { get; set; }
    public decimal PredictedDailyDemand { get; set; }
    public decimal? Confidence { get; set; }
    public decimal? DaysUntilStockOut { get; set; }   // derived here, not by the model (D17)
    public int RecommendedQuantity { get; set; }
    public string? ModelVersion { get; set; }
    public bool UsedFallback { get; set; }
    public string? FallbackReason { get; set; }        // insufficientHistory | lowConfidence | modelUnavailable
    public DateTime CreatedAt { get; set; }
}
