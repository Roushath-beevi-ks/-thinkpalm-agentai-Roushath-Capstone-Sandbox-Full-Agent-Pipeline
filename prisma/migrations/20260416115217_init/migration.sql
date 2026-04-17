-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionKey" TEXT NOT NULL,
    "strictLint" BOOLEAN NOT NULL DEFAULT false,
    "preferA11y" BOOLEAN NOT NULL DEFAULT true,
    "maxFixFiles" INTEGER NOT NULL DEFAULT 3,
    "notes" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReviewMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "embedding" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionKey" TEXT NOT NULL,
    "traceJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_sessionKey_key" ON "UserPreference"("sessionKey");

-- CreateIndex
CREATE INDEX "ReviewMemory_sessionKey_idx" ON "ReviewMemory"("sessionKey");

-- CreateIndex
CREATE INDEX "PipelineRun_sessionKey_idx" ON "PipelineRun"("sessionKey");
