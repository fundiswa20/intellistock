
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Alert` (
  `AlertId` int NOT NULL AUTO_INCREMENT,
  `StockItemId` int NOT NULL,
  `Type` varchar(20) NOT NULL DEFAULT 'LowStock',
  `Message` varchar(255) NOT NULL,
  `QuantityAtAlert` int NOT NULL,
  `ReorderLevel` int NOT NULL,
  `CreatedAt` datetime NOT NULL,
  `ResolvedAt` datetime DEFAULT NULL,
  `OpenFlag` tinyint(1) GENERATED ALWAYS AS (if((`ResolvedAt` is null),1,NULL)) STORED,
  PRIMARY KEY (`AlertId`),
  UNIQUE KEY `UX_Alert_OneOpenPerItem` (`StockItemId`,`OpenFlag`),
  KEY `IX_Alert_Open` (`ResolvedAt`),
  CONSTRAINT `FK_Alert_StockItem` FOREIGN KEY (`StockItemId`) REFERENCES `StockItem` (`StockItemId`),
  CONSTRAINT `CK_Alert_Type` CHECK ((`Type` = _utf8mb4'LowStock'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `BusinessOwner` (
  `RegisteredUserId` int NOT NULL,
  `BusinessName` varchar(120) NOT NULL,
  `Location` varchar(120) NOT NULL,
  `Phone` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`RegisteredUserId`),
  CONSTRAINT `FK_BusinessOwner_RegisteredUser` FOREIGN KEY (`RegisteredUserId`) REFERENCES `RegisteredUser` (`RegisteredUserId`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `RegisteredUser` (
  `RegisteredUserId` int NOT NULL AUTO_INCREMENT,
  `Email` varchar(255) NOT NULL,
  `PasswordHash` varchar(255) NOT NULL,
  `FullName` varchar(120) NOT NULL,
  `Role` varchar(20) NOT NULL,
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`RegisteredUserId`),
  UNIQUE KEY `UX_RegisteredUser_Email` (`Email`),
  CONSTRAINT `CK_RegisteredUser_Role` CHECK ((`Role` in (_utf8mb4'BusinessOwner',_utf8mb4'Supplier')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ReorderPrediction` (
  `ReorderPredictionId` int NOT NULL AUTO_INCREMENT,
  `StockItemId` int NOT NULL,
  `PredictedDailyDemand` decimal(10,3) NOT NULL,
  `Confidence` decimal(4,3) DEFAULT NULL,
  `DaysUntilStockOut` decimal(8,1) DEFAULT NULL,
  `RecommendedQuantity` int NOT NULL,
  `ModelVersion` varchar(40) DEFAULT NULL,
  `UsedFallback` tinyint(1) NOT NULL DEFAULT '0',
  `FallbackReason` varchar(40) DEFAULT NULL,
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ReorderPredictionId`),
  KEY `IX_ReorderPrediction_Item_Time` (`StockItemId`,`CreatedAt`),
  CONSTRAINT `FK_ReorderPrediction_StockItem` FOREIGN KEY (`StockItemId`) REFERENCES `StockItem` (`StockItemId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `StockItem` (
  `StockItemId` int NOT NULL AUTO_INCREMENT,
  `BusinessOwnerId` int NOT NULL,
  `Name` varchar(120) NOT NULL,
  `Category` varchar(40) NOT NULL,
  `Unit` varchar(30) NOT NULL DEFAULT 'each',
  `QuantityOnHand` int NOT NULL DEFAULT '0',
  `ReorderLevel` int NOT NULL DEFAULT '0',
  `UnitCost` decimal(10,2) NOT NULL,
  `SellingPrice` decimal(10,2) NOT NULL,
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`StockItemId`),
  KEY `IX_StockItem_Owner` (`BusinessOwnerId`,`IsActive`),
  CONSTRAINT `FK_StockItem_BusinessOwner` FOREIGN KEY (`BusinessOwnerId`) REFERENCES `BusinessOwner` (`RegisteredUserId`),
  CONSTRAINT `CK_StockItem_Prices` CHECK (((`UnitCost` >= 0) and (`SellingPrice` >= 0))),
  CONSTRAINT `CK_StockItem_Quantity` CHECK ((`QuantityOnHand` >= 0)),
  CONSTRAINT `CK_StockItem_ReorderLevel` CHECK ((`ReorderLevel` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Supplier` (
  `RegisteredUserId` int NOT NULL,
  `CompanyName` varchar(120) NOT NULL,
  `Phone` varchar(20) DEFAULT NULL,
  `DeliveryArea` varchar(120) DEFAULT NULL,
  PRIMARY KEY (`RegisteredUserId`),
  CONSTRAINT `FK_Supplier_RegisteredUser` FOREIGN KEY (`RegisteredUserId`) REFERENCES `RegisteredUser` (`RegisteredUserId`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SupplierListing` (
  `SupplierListingId` int NOT NULL AUTO_INCREMENT,
  `SupplierId` int NOT NULL,
  `ProductName` varchar(120) NOT NULL,
  `Category` varchar(40) NOT NULL,
  `PackSize` int NOT NULL DEFAULT '1',
  `PackPrice` decimal(10,2) NOT NULL,
  `LeadTimeDays` int NOT NULL DEFAULT '1',
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`SupplierListingId`),
  KEY `IX_SupplierListing_Product` (`ProductName`),
  KEY `FK_SupplierListing_Supplier` (`SupplierId`),
  CONSTRAINT `FK_SupplierListing_Supplier` FOREIGN KEY (`SupplierId`) REFERENCES `Supplier` (`RegisteredUserId`),
  CONSTRAINT `CK_SupplierListing` CHECK (((`PackSize` > 0) and (`PackPrice` >= 0) and (`LeadTimeDays` >= 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Transaction` (
  `TransactionId` bigint NOT NULL AUTO_INCREMENT,
  `StockItemId` int NOT NULL,
  `Type` varchar(20) NOT NULL,
  `QuantityChange` int NOT NULL,
  `QuantityAfter` int NOT NULL,
  `OccurredAt` datetime NOT NULL,
  `RecordedByUserId` int NOT NULL,
  `Note` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`TransactionId`),
  KEY `IX_Transaction_Item_Time` (`StockItemId`,`OccurredAt`),
  KEY `FK_Transaction_RecordedBy` (`RecordedByUserId`),
  CONSTRAINT `FK_Transaction_RecordedBy` FOREIGN KEY (`RecordedByUserId`) REFERENCES `RegisteredUser` (`RegisteredUserId`),
  CONSTRAINT `FK_Transaction_StockItem` FOREIGN KEY (`StockItemId`) REFERENCES `StockItem` (`StockItemId`) ON DELETE RESTRICT,
  CONSTRAINT `CK_Transaction_After` CHECK ((`QuantityAfter` >= 0)),
  CONSTRAINT `CK_Transaction_Sign` CHECK ((((`Type` = _utf8mb4'Sale') and (`QuantityChange` < 0)) or ((`Type` = _utf8mb4'Restock') and (`QuantityChange` > 0)) or ((`Type` = _utf8mb4'Adjustment') and (`QuantityChange` <> 0)))),
  CONSTRAINT `CK_Transaction_Type` CHECK ((`Type` in (_utf8mb4'Sale',_utf8mb4'Restock',_utf8mb4'Adjustment')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `TR_Transaction_NoUpdate` BEFORE UPDATE ON `Transaction` FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'FR-04: transactions are immutable - record an Adjustment instead';
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `TR_Transaction_NoDelete` BEFORE DELETE ON `Transaction` FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'FR-04: transactions are immutable and cannot be deleted';
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

