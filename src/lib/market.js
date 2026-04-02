export function liquidityWithinPct(book, pct = 0.02) {
  if (!book?.bids?.length || !book?.asks?.length) {
    return null;
  }

  const bestBid = Number(book.bids[0].price);
  const bestAsk = Number(book.asks[0].price);

  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0) {
    return null;
  }

  const mid = (bestBid + bestAsk) / 2;
  const minBid = mid * (1 - pct);
  const maxAsk = mid * (1 + pct);

  const bidLiquidity = book.bids.reduce((sum, level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size) || price < minBid) {
      return sum;
    }

    return sum + price * size;
  }, 0);

  const askLiquidity = book.asks.reduce((sum, level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size) || price > maxAsk) {
      return sum;
    }

    return sum + price * size;
  }, 0);

  return bidLiquidity + askLiquidity;
}

export function annualizeFunding(rate, intervalHours) {
  if (!Number.isFinite(rate) || !Number.isFinite(intervalHours) || intervalHours <= 0) {
    return null;
  }

  const periodsPerYear = (24 / intervalHours) * 365;
  return (Math.pow(1 + rate, periodsPerYear) - 1) * 100;
}

export function priceDeviationPct(price, referencePrice) {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0
  ) {
    return null;
  }

  return ((price - referencePrice) / referencePrice) * 100;
}

export function normalizeOrderBook(levels) {
  return {
    bids: (levels?.bids ?? []).map(([price, size]) => ({
      price: Number(price),
      size: Number(size)
    })),
    asks: (levels?.asks ?? []).map(([price, size]) => ({
      price: Number(price),
      size: Number(size)
    }))
  };
}
