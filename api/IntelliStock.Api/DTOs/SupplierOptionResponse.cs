namespace IntelliStock.Api.DTOs;

public record  SupplierOptionResponse
{
    public int SupplierListingId {get; init;}
    public int SupplierId{get; init;}
    public string CompanyName {get; init;} ="";

    public string DeliveryArea {get;init;} ="";
    public decimal PackPrice{get; init;}
    public int PackSize{get;init;}
    public int PacksRequired{get;init;}
    public decimal DeliveryCost{get; init;}
    public decimal TotalDeliveredCost{get; init;}
    public int LeadTimeDays{get; init;}
    public decimal ReliabilityScore{get; init;}
    public bool ServesMyArea{get; init;}
    public decimal Score{get; init;}
    public bool IsRecommended{get; init;}
    public string ScoreBreakdown{get; init;} ="";






}
