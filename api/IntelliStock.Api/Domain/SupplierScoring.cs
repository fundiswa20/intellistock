namespace IntelliStock.Api.Domain;

// The supplier recommendation is a deterministic weighted score, NOT the ML model.
// The demand forecast is used only on the owner side, to decide when and how much to order.
public static class SupplierScoring
{
    private const decimal CostWeight        = 0.50m;
    private const decimal LeadTimeWeight    = 0.20m;
    private const decimal ReliabilityWeight = 0.20m;
    private const decimal AreaWeight        = 0.10m;

    public static int PacksRequired(int quantityNeeded, int packSize)
        => packSize <= 0 ? 0 : (int)Math.Ceiling((double)quantityNeeded / packSize);

    public static decimal TotalDeliveredCost(
        int quantityNeeded, int packSize, decimal packPrice, decimal deliveryCost)
        => PacksRequired(quantityNeeded, packSize) * packPrice + deliveryCost;

    // Each factor is normalised to 0..1 against the best option, so the cheapest
    // scores exactly 1.0 on cost and one costing twice as much scores 0.5.
    public static decimal Score(
        decimal thisCost, decimal cheapestCost,
        int thisLeadDays, int fastestLeadDays,
        decimal reliability, bool servesMyArea)
    {
        var costScore = thisCost <= 0 ? 0m : cheapestCost / thisCost;
        var leadScore = thisLeadDays <= 0 ? 1m : (decimal)fastestLeadDays / thisLeadDays;
        var areaScore = servesMyArea ? 1m : 0m;

        return CostWeight        * costScore
             + LeadTimeWeight    * leadScore
             + ReliabilityWeight * reliability
             + AreaWeight        * areaScore;
    }

    public static string Breakdown(
        decimal cost, int leadDays, decimal reliability, bool servesMyArea)
        => $"R{cost:0.00} delivered · {leadDays} day lead · "
         + $"{reliability:P0} fulfilment · {(servesMyArea ? "serves your area" : "outside your area")}";
}