using System;

namespace IntelliStock.Api.Domain;

public static class SupplierScoring
{
    // weights — must sum to 1.0
    private const decimal CostWeight        = 0.50m;
    private const decimal LeadTimeWeight    = 0.20m;
    private const decimal ReliabilityWeight = 0.20m;
    private const decimal AreaWeight        = 0.10m;

    public static int PacksRequired(int quantityNeeded, int packSize)
        => (int)Math.Ceiling((double)quantityNeeded / packSize);

    public static decimal TotalDeliveredCost(int quantityNeeded, int packSize,
                                             decimal packPrice, decimal deliveryCost)
        => PacksRequired(quantityNeeded, packSize) * packPrice + deliveryCost;

    // each factor is normalised to 0..1 where 1 is best
    public static decimal Score(decimal thisCost, decimal cheapestCost,
                                int thisLeadDays, int fastestLeadDays,
                                decimal reliability, bool servesMyArea)
    {
        var costScore     = cheapestCost    / thisCost;      // cheapest scores 1.0
        var leadScore     = thisLeadDays == 0 ? 1m
                            : (decimal)fastestLeadDays / thisLeadDays;
        var areaScore     = servesMyArea ? 1m : 0m;

        return CostWeight        * costScore
             + LeadTimeWeight    * leadScore
             + ReliabilityWeight * reliability
             + AreaWeight        * areaScore;
    }
}
