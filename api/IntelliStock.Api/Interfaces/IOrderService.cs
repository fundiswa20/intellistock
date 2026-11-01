using System;
using IntelliStock.Api.DTOs;

namespace IntelliStock.Api.Interfaces;

public interface IOrderService
{
     // --- owner side (steps 12, 13)
    Task<OrderResponse>       PlaceOrderAsync(int businessOwnerId, PlaceOrderRequest req);
    Task<List<OrderResponse>> GetMyOrdersAsync(int businessOwnerId);
    Task<OrderResponse?>      GetOrderAsync(int businessOwnerId, int orderId);
}
