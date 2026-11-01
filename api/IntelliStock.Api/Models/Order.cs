using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Models;

public class Order
{
    public int OrderId { get; set; }
    public int BusinessOwnerId { get; set; }
    public int SupplierId { get; set; }
    public string Status { get; set; } = "Placed";
    public decimal TotalCost { get; set; }
    public DateTime PlacedAt { get; set; }
    public DateTime? ExpectedDeliveryAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
}
