-- CreateTable
CREATE TABLE "Grid" (
    "id" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "upperPrice" DOUBLE PRECISION NOT NULL,
    "lowerPrice" DOUBLE PRECISION NOT NULL,
    "gridCount" INTEGER NOT NULL,
    "gridType" TEXT NOT NULL DEFAULT 'arithmetic',
    "leverage" INTEGER NOT NULL,
    "investmentAmount" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "currentPrice" DOUBLE PRECISION,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unrealizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "Grid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GridOrder" (
    "id" TEXT NOT NULL,
    "gridId" TEXT NOT NULL,
    "gridLevel" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "filledPrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "grvtOrderId" TEXT,
    "filledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GridOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GridTrade" (
    "id" TEXT NOT NULL,
    "gridId" TEXT NOT NULL,
    "buyOrderId" TEXT NOT NULL,
    "sellOrderId" TEXT NOT NULL,
    "buyPrice" DOUBLE PRECISION NOT NULL,
    "sellPrice" DOUBLE PRECISION NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "profit" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GridTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PnlSnapshot" (
    "id" TEXT NOT NULL,
    "gridId" TEXT NOT NULL,
    "realizedPnl" DOUBLE PRECISION NOT NULL,
    "unrealizedPnl" DOUBLE PRECISION NOT NULL,
    "totalPnl" DOUBLE PRECISION NOT NULL,
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PnlSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Grid_status_idx" ON "Grid"("status");

-- CreateIndex
CREATE INDEX "Grid_instrument_idx" ON "Grid"("instrument");

-- CreateIndex
CREATE UNIQUE INDEX "GridOrder_grvtOrderId_key" ON "GridOrder"("grvtOrderId");

-- CreateIndex
CREATE INDEX "GridOrder_gridId_status_idx" ON "GridOrder"("gridId", "status");

-- CreateIndex
CREATE INDEX "GridOrder_grvtOrderId_idx" ON "GridOrder"("grvtOrderId");

-- CreateIndex
CREATE INDEX "GridTrade_gridId_idx" ON "GridTrade"("gridId");

-- CreateIndex
CREATE INDEX "PnlSnapshot_gridId_timestamp_idx" ON "PnlSnapshot"("gridId", "timestamp");

-- AddForeignKey
ALTER TABLE "GridOrder" ADD CONSTRAINT "GridOrder_gridId_fkey" FOREIGN KEY ("gridId") REFERENCES "Grid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GridTrade" ADD CONSTRAINT "GridTrade_gridId_fkey" FOREIGN KEY ("gridId") REFERENCES "Grid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GridTrade" ADD CONSTRAINT "GridTrade_buyOrderId_fkey" FOREIGN KEY ("buyOrderId") REFERENCES "GridOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GridTrade" ADD CONSTRAINT "GridTrade_sellOrderId_fkey" FOREIGN KEY ("sellOrderId") REFERENCES "GridOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PnlSnapshot" ADD CONSTRAINT "PnlSnapshot_gridId_fkey" FOREIGN KEY ("gridId") REFERENCES "Grid"("id") ON DELETE CASCADE ON UPDATE CASCADE;
