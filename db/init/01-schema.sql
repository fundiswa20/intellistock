-- IntelliStock schema - MySQL 8.0
--
-- Table names match the classes in the submitted UML class diagram exactly.
-- RegisteredUser is the base class; BusinessOwner and Supplier each have their own
-- table sharing its primary key (table-per-type, mapped the same way in EF Core).
--
-- Run automatically by the mysql container from /docker-entrypoint-initdb.d on first
-- start; 02-seed.sql runs after it.

SET NAMES utf8mb4;
USE intellistock;

-- ---------------------------------------------------------------- users

-- FR-01 / FR-02: users register through POST /api/auth/register (owners and suppliers);
-- the seed adds the demo accounts
CREATE TABLE RegisteredUser (
    RegisteredUserId  INT           NOT NULL AUTO_INCREMENT,
    Email             VARCHAR(255)  NOT NULL,
    PasswordHash      VARCHAR(255)  NOT NULL,   -- ASP.NET Core Identity PasswordHasher v3 format
    FullName          VARCHAR(120)  NOT NULL,
    Role              VARCHAR(20)   NOT NULL,
    CreatedAt         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (RegisteredUserId),
    UNIQUE KEY UX_RegisteredUser_Email (Email),
    CONSTRAINT CK_RegisteredUser_Role CHECK (Role IN ('BusinessOwner', 'Supplier'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE BusinessOwner (
    RegisteredUserId  INT           NOT NULL,
    BusinessName      VARCHAR(120)  NOT NULL,
    Location          VARCHAR(120)  NOT NULL,
    Phone             VARCHAR(20)   NULL,
    PRIMARY KEY (RegisteredUserId),
    CONSTRAINT FK_BusinessOwner_RegisteredUser FOREIGN KEY (RegisteredUserId)
        REFERENCES RegisteredUser (RegisteredUserId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- FR-06 / FR-07: suppliers manage their own listings and orders (D37).
-- ReliabilityScore: share of past orders delivered on time, 0.00 to 1.00.
CREATE TABLE Supplier (
    RegisteredUserId  INT           NOT NULL,
    CompanyName       VARCHAR(120)  NOT NULL,
    Phone             VARCHAR(20)   NULL,
    DeliveryArea      VARCHAR(120)  NULL,
    ReliabilityScore  DECIMAL(3,2)  NOT NULL DEFAULT 0.00,
    PRIMARY KEY (RegisteredUserId),
    CONSTRAINT CK_Supplier_Reliability CHECK (ReliabilityScore BETWEEN 0 AND 1),
    CONSTRAINT FK_Supplier_RegisteredUser FOREIGN KEY (RegisteredUserId)
        REFERENCES RegisteredUser (RegisteredUserId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------- stock

-- FR-03: stock item CRUD. Delete is a soft delete (IsActive = 0): a hard delete
-- would have to delete the item's transactions, and FR-04 makes those immutable.
CREATE TABLE StockItem (
    StockItemId       INT            NOT NULL AUTO_INCREMENT,
    BusinessOwnerId   INT            NOT NULL,
    Name              VARCHAR(120)   NOT NULL,
    Category          VARCHAR(40)    NOT NULL,   -- must be a category the model knows (D16/O2)
    Unit              VARCHAR(30)    NOT NULL DEFAULT 'each',
    QuantityOnHand    INT            NOT NULL DEFAULT 0,
    ReorderLevel      INT            NOT NULL DEFAULT 0,
    UnitCost          DECIMAL(10,2)  NOT NULL,
    SellingPrice      DECIMAL(10,2)  NOT NULL,
    IsActive          TINYINT(1)     NOT NULL DEFAULT 1,
    CreatedAt         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (StockItemId),
    KEY IX_StockItem_Owner (BusinessOwnerId, IsActive),
    CONSTRAINT FK_StockItem_BusinessOwner FOREIGN KEY (BusinessOwnerId)
        REFERENCES BusinessOwner (RegisteredUserId),
    CONSTRAINT CK_StockItem_Quantity CHECK (QuantityOnHand >= 0),
    CONSTRAINT CK_StockItem_ReorderLevel CHECK (ReorderLevel >= 0),
    CONSTRAINT CK_StockItem_Prices CHECK (UnitCost >= 0 AND SellingPrice >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- FR-04: the stock movement log. Rows are append-only - see the triggers below.
-- QuantityChange is signed (a sale is negative); QuantityAfter is the balance after
-- the movement, so the log can be audited against StockItem.QuantityOnHand.
CREATE TABLE `Transaction` (
    TransactionId     BIGINT         NOT NULL AUTO_INCREMENT,
    StockItemId       INT            NOT NULL,
    Type              VARCHAR(20)    NOT NULL,
    QuantityChange    INT            NOT NULL,
    QuantityAfter     INT            NOT NULL,
    OccurredAt        DATETIME       NOT NULL,
    RecordedByUserId  INT            NOT NULL,
    Note              VARCHAR(255)   NULL,
    PRIMARY KEY (TransactionId),
    KEY IX_Transaction_Item_Time (StockItemId, OccurredAt),
    CONSTRAINT FK_Transaction_StockItem FOREIGN KEY (StockItemId)
        REFERENCES StockItem (StockItemId) ON DELETE RESTRICT,
    CONSTRAINT FK_Transaction_RecordedBy FOREIGN KEY (RecordedByUserId)
        REFERENCES RegisteredUser (RegisteredUserId),
    CONSTRAINT CK_Transaction_Type CHECK (Type IN ('Sale', 'Restock', 'Adjustment')),
    CONSTRAINT CK_Transaction_Sign CHECK (
        (Type = 'Sale'    AND QuantityChange < 0) OR
        (Type = 'Restock' AND QuantityChange > 0) OR
        (Type = 'Adjustment' AND QuantityChange <> 0)),
    CONSTRAINT CK_Transaction_After CHECK (QuantityAfter >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- FR-04: transactions are immutable. Enforced in the database, not only in the API,
-- so no code path - including a bug or a manual query - can rewrite stock history.
-- A mistake is corrected with a new 'Adjustment' row.
DELIMITER //
CREATE TRIGGER TR_Transaction_NoUpdate BEFORE UPDATE ON `Transaction`
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'FR-04: transactions are immutable - record an Adjustment instead';
END//
CREATE TRIGGER TR_Transaction_NoDelete BEFORE DELETE ON `Transaction`
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'FR-04: transactions are immutable and cannot be deleted';
END//
DELIMITER ;

-- ---------------------------------------------------------------- alerts

-- FR-05: raised when a movement takes QuantityOnHand to or below ReorderLevel;
-- resolved (ResolvedAt set) when a restock takes it back above. At most one open
-- alert per item, enforced by the generated OpenFlag column.
CREATE TABLE Alert (
    AlertId           INT            NOT NULL AUTO_INCREMENT,
    StockItemId       INT            NOT NULL,
    Type              VARCHAR(20)    NOT NULL DEFAULT 'LowStock',
    Message           VARCHAR(255)   NOT NULL,
    QuantityAtAlert   INT            NOT NULL,
    ReorderLevel      INT            NOT NULL,
    CreatedAt         DATETIME       NOT NULL,
    ResolvedAt        DATETIME       NULL,
    OpenFlag          TINYINT(1)     AS (IF(ResolvedAt IS NULL, 1, NULL)) STORED,
    PRIMARY KEY (AlertId),
    UNIQUE KEY UX_Alert_OneOpenPerItem (StockItemId, OpenFlag),
    KEY IX_Alert_Open (ResolvedAt),
    CONSTRAINT FK_Alert_StockItem FOREIGN KEY (StockItemId)
        REFERENCES StockItem (StockItemId),
    CONSTRAINT CK_Alert_Type CHECK (Type IN ('LowStock'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------- predictions

-- FR-08: every prediction shown to the owner is stored, with the model version
-- and whether the ETR-03 fallback was used, so a recommendation can be traced.
CREATE TABLE ReorderPrediction (
    ReorderPredictionId   INT            NOT NULL AUTO_INCREMENT,
    StockItemId           INT            NOT NULL,
    PredictedDailyDemand  DECIMAL(10,3)  NOT NULL,
    Confidence            DECIMAL(4,3)   NULL,       -- NULL when the model was not used
    DaysUntilStockOut     DECIMAL(8,1)   NULL,       -- NULL when demand is 0 (D17)
    RecommendedQuantity   INT            NOT NULL,
    ModelVersion          VARCHAR(40)    NULL,
    UsedFallback          TINYINT(1)     NOT NULL DEFAULT 0,
    FallbackReason        VARCHAR(40)    NULL,       -- 'insufficientHistory' | 'lowConfidence' | 'modelUnavailable'
    CreatedAt             DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ReorderPredictionId),
    KEY IX_ReorderPrediction_Item_Time (StockItemId, CreatedAt),
    CONSTRAINT FK_ReorderPrediction_StockItem FOREIGN KEY (StockItemId)
        REFERENCES StockItem (StockItemId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------- supplier listings

-- FR-06 / FR-07: a supplier's price list. AvailableQuantity is in packs; DeliveryCost is
-- a flat fee per order. IsActive = 0 hides a listing from owners without deleting it,
-- because orders keep pointing at it.
CREATE TABLE SupplierListing (
    SupplierListingId INT            NOT NULL AUTO_INCREMENT,
    SupplierId        INT            NOT NULL,
    ProductName       VARCHAR(120)   NOT NULL,
    Category          VARCHAR(40)    NOT NULL,
    PackSize          INT            NOT NULL DEFAULT 1,
    PackPrice         DECIMAL(10,2)  NOT NULL,
    LeadTimeDays      INT            NOT NULL DEFAULT 1,
    IsActive          TINYINT(1)     NOT NULL DEFAULT 1,
    AvailableQuantity INT            NOT NULL DEFAULT 0,
    DeliveryCost      DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    UpdatedAt         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (SupplierListingId),
    KEY IX_SupplierListing_Product (ProductName),
    CONSTRAINT FK_SupplierListing_Supplier FOREIGN KEY (SupplierId)
        REFERENCES Supplier (RegisteredUserId),
    CONSTRAINT CK_SupplierListing CHECK (PackSize > 0 AND PackPrice >= 0 AND LeadTimeDays >= 0
                                         AND AvailableQuantity >= 0 AND DeliveryCost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------- orders

-- FR-10: an owner orders whole packs of one listing from one supplier. Product, pack size,
-- prices and delivery fee are copied from the listing when the order is placed, so a later
-- price change does not rewrite an order. Status moves Placed -> Confirmed -> Dispatched ->
-- Delivered; the supplier may decline and the owner may cancel while it is still Placed.
-- ReceivedAt is set when the owner books the delivery into stock (a Restock movement).
CREATE TABLE PurchaseOrder (
    PurchaseOrderId   INT            NOT NULL AUTO_INCREMENT,
    BusinessOwnerId   INT            NOT NULL,
    SupplierId        INT            NOT NULL,
    SupplierListingId INT            NOT NULL,
    StockItemId       INT            NULL,
    ProductName       VARCHAR(120)   NOT NULL,
    PackSize          INT            NOT NULL,
    PackPrice         DECIMAL(10,2)  NOT NULL,
    Packs             INT            NOT NULL,
    DeliveryCost      DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    Status            VARCHAR(20)    NOT NULL DEFAULT 'Placed',
    Note              VARCHAR(255)   NULL,
    CreatedAt         DATETIME       NOT NULL,
    ConfirmedAt       DATETIME       NULL,
    DispatchedAt      DATETIME       NULL,
    DeliveredAt       DATETIME       NULL,
    ClosedAt          DATETIME       NULL,   -- declined or cancelled
    ReceivedAt        DATETIME       NULL,
    PRIMARY KEY (PurchaseOrderId),
    KEY IX_PurchaseOrder_Owner (BusinessOwnerId, CreatedAt),
    KEY IX_PurchaseOrder_Supplier (SupplierId, CreatedAt),
    CONSTRAINT FK_PurchaseOrder_Owner FOREIGN KEY (BusinessOwnerId)
        REFERENCES BusinessOwner (RegisteredUserId),
    CONSTRAINT FK_PurchaseOrder_Supplier FOREIGN KEY (SupplierId)
        REFERENCES Supplier (RegisteredUserId),
    CONSTRAINT FK_PurchaseOrder_Listing FOREIGN KEY (SupplierListingId)
        REFERENCES SupplierListing (SupplierListingId),
    CONSTRAINT FK_PurchaseOrder_StockItem FOREIGN KEY (StockItemId)
        REFERENCES StockItem (StockItemId),
    CONSTRAINT CK_PurchaseOrder_Packs CHECK (Packs > 0 AND PackSize > 0),
    CONSTRAINT CK_PurchaseOrder_Status CHECK (Status IN
        ('Placed', 'Confirmed', 'Dispatched', 'Delivered', 'Declined', 'Cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
