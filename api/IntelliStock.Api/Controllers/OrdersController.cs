using System.Security.Claims;
using IntelliStock.Api.DTOs;
using IntelliStock.Api.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace IntelliStock.Api.Controllers;

// Owner side - FR-10. Orders placed against a supplier listing.
[ApiController]
[Route("api/orders")]
[Authorize(Roles = "BusinessOwner")]
public class OrdersController : ControllerBase
{
    private readonly IOrderService orders;

    public OrdersController(IOrderService orders)
    {
        this.orders = orders;
    }

    private int OwnerId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<IActionResult> GetOrders()
        => Ok(await orders.GetMyOrdersAsync(OwnerId));

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetOrder(int id)
    {
        var order = await orders.GetOrderAsync(OwnerId, id);
        return order is null ? NotFound() : Ok(order);
    }

    [HttpPost]
    public async Task<IActionResult> PlaceOrder(PlaceOrderRequest req)
    {
        var created = await orders.PlaceOrderAsync(OwnerId, req);
        return CreatedAtAction(nameof(GetOrder), new { id = created.OrderId }, created);
    }
}