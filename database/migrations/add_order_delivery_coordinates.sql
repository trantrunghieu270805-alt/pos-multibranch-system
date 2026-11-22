USE [MultiBranchPOS];
GO

IF COL_LENGTH(N'dbo.Orders', N'Latitude') IS NULL
    ALTER TABLE dbo.Orders ADD Latitude DECIMAL(9,6) NULL;
GO

IF COL_LENGTH(N'dbo.Orders', N'Longitude') IS NULL
    ALTER TABLE dbo.Orders ADD Longitude DECIMAL(9,6) NULL;
GO

IF OBJECT_ID(N'dbo.CK_Orders_DeliveryCoordinates', N'C') IS NULL
    ALTER TABLE dbo.Orders
    ADD CONSTRAINT CK_Orders_DeliveryCoordinates CHECK (
        (Latitude IS NULL AND Longitude IS NULL)
        OR (
            Latitude IS NOT NULL AND Longitude IS NOT NULL
            AND Latitude BETWEEN -90 AND 90 AND Longitude BETWEEN -180 AND 180
        )
    );
GO
