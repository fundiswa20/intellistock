using System;
using IntelliStock.Api.DTOs;

namespace IntelliStock.Api.Interfaces;

public interface ISupplierComparisonService
{
     // --- owner side (steps 6 to 11) — one call does retrieve, cost, score, rank
    Task<List<SupplierOptionResponse>> CompareAsync(int businessOwnerId, int stockItemId, int quantity);
}
