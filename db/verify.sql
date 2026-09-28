-- IntelliStock - seed data verification. Run by db/verify.sh; output in evidence/db-verification.txt
USE intellistock;

SELECT '1. Row counts' AS `check`;
SELECT 'RegisteredUser' AS tbl, COUNT(*) AS `rows` FROM RegisteredUser
UNION ALL SELECT 'BusinessOwner', COUNT(*) FROM BusinessOwner
UNION ALL SELECT 'Supplier', COUNT(*) FROM Supplier
UNION ALL SELECT 'StockItem', COUNT(*) FROM StockItem
UNION ALL SELECT 'Transaction', COUNT(*) FROM `Transaction`
UNION ALL SELECT 'Alert', COUNT(*) FROM Alert
UNION ALL SELECT 'ReorderPrediction', COUNT(*) FROM ReorderPrediction
UNION ALL SELECT 'SupplierListing', COUNT(*) FROM SupplierListing;

SELECT '2. QuantityOnHand equals the sum of the transaction log, for every item (expect 0 mismatches)' AS `check`;
SELECT COUNT(*) AS mismatches FROM StockItem s
WHERE s.QuantityOnHand <> (SELECT COALESCE(SUM(t.QuantityChange), 0) FROM `Transaction` t WHERE t.StockItemId = s.StockItemId);

SELECT '3. QuantityAfter is the running balance on every row (expect 0 mismatches)' AS `check`;
SELECT COUNT(*) AS mismatches FROM (
    SELECT QuantityAfter,
           SUM(QuantityChange) OVER (PARTITION BY StockItemId ORDER BY OccurredAt, TransactionId) AS running
    FROM `Transaction`) x
WHERE x.QuantityAfter <> x.running;

SELECT '4. Every item at or below its reorder level has exactly one open alert (expect 0 mismatches)' AS `check`;
SELECT COUNT(*) AS mismatches FROM StockItem s
WHERE (s.QuantityOnHand <= s.ReorderLevel) <> EXISTS (
    SELECT 1 FROM Alert a WHERE a.StockItemId = s.StockItemId AND a.ResolvedAt IS NULL);

SELECT '5. Nomvula''s Spaza - stock list as of the end of the seed' AS `check`;
SELECT s.StockItemId AS id, s.Name, s.QuantityOnHand AS onHand, s.ReorderLevel AS reorderAt,
       s.SellingPrice AS price,
       IF(s.QuantityOnHand <= s.ReorderLevel, 'LOW', '') AS status,
       (SELECT COUNT(DISTINCT DATE(t.OccurredAt)) FROM `Transaction` t
         WHERE t.StockItemId = s.StockItemId) AS daysOfHistory,
       ROUND((SELECT -SUM(t.QuantityChange) FROM `Transaction` t
         WHERE t.StockItemId = s.StockItemId AND t.Type = 'Sale'
           AND t.OccurredAt >= '2026-08-29') / 30, 1) AS avgSold30d
FROM StockItem s WHERE s.BusinessOwnerId = 1 ORDER BY s.StockItemId;

SELECT '6. Open alerts' AS `check`;
SELECT a.AlertId, o.BusinessName, a.Message, a.CreatedAt
FROM Alert a JOIN StockItem s ON s.StockItemId = a.StockItemId
JOIN BusinessOwner o ON o.RegisteredUserId = s.BusinessOwnerId
WHERE a.ResolvedAt IS NULL ORDER BY o.BusinessName, a.CreatedAt;

SELECT '7. Transaction log sample - Iwisa Super Maize Meal 5kg, last 12 movements' AS `check`;
SELECT TransactionId, Type, QuantityChange, QuantityAfter, OccurredAt, Note
FROM (SELECT * FROM `Transaction` WHERE StockItemId = 3 ORDER BY OccurredAt DESC, TransactionId DESC LIMIT 12) x
ORDER BY OccurredAt, TransactionId;

SELECT '8. Supplier price comparison - Iwisa Super Maize Meal 5kg (FR-06/07 seeded data)' AS `check`;
SELECT sp.CompanyName, l.PackSize, l.PackPrice, ROUND(l.PackPrice / l.PackSize, 2) AS perUnit, l.LeadTimeDays
FROM SupplierListing l JOIN Supplier sp ON sp.RegisteredUserId = l.SupplierId
WHERE l.ProductName = 'Iwisa Super Maize Meal 5kg' ORDER BY perUnit;

SELECT '9. Triggers enforcing FR-04' AS `check`;
SELECT TRIGGER_NAME, EVENT_MANIPULATION AS event, ACTION_TIMING AS timing, EVENT_OBJECT_TABLE AS tbl
FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = 'intellistock';
