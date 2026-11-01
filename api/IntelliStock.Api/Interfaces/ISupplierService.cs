using System;
using IntelliStock.Api.DTOs;

namespace IntelliStock.Api.Interfaces;

public interface ISupplierService
{
    // --- supplier's own listings (steps 2, 4)
    Task<List<ListingResponse>> GetMyListingsAsync(int supplierId);
    Task<ListingResponse?>      GetListingAsync(int supplierId, int listingId);
    Task<ListingResponse>       CreateListingAsync(int supplierId, ListingRequest req);
    Task<ListingResponse?>      UpdateListingAsync(int supplierId, int listingId, ListingRequest req);
    Task<bool>                  WithdrawListingAsync(int supplierId, int listingId);

    // --- supplier's incoming orders (steps 14, 19)
    Task<List<OrderResponse>>   GetMyOrdersAsync(int supplierId);
    Task<OrderResponse?>        UpdateOrderStatusAsync(int supplierId, int orderId, string status);
}
