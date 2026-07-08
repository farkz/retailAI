import { expect } from 'chai';
import { calcTax, round2, WinTaxCategory } from '../../helpers/taxUtils';

describe('taxUtils', function () {

  // ─── round2 ────────────────────────────────────────────────────────────────

  describe('round2', function () {
    it('leaves an integer unchanged', function () {
      expect(round2(10)).to.equal(10);
    });

    it('leaves a value already at 2 dp unchanged', function () {
      expect(round2(1.23)).to.equal(1.23);
    });

    it('truncates extra decimal places (round down)', function () {
      expect(round2(1.234)).to.equal(1.23);
    });

    it('rounds up when 3rd decimal ≥ 5', function () {
      expect(round2(1.236)).to.equal(1.24);
    });

    it('handles zero', function () {
      expect(round2(0)).to.equal(0);
    });

    it('rounds classic floating-point sum (0.1 + 0.2) to 0.30', function () {
      expect(round2(0.1 + 0.2)).to.equal(0.3);
    });

    it('rounds a 3-dp intermediate value correctly (truncates when 3rd dp < 5)', function () {
      expect(round2(9.994)).to.equal(9.99);
    });

    it('rounds a 3-dp intermediate value correctly (rounds up when 3rd dp ≥ 5)', function () {
      expect(round2(9.996)).to.equal(10);
    });
  });

  // ─── calcTax – zero-tax cases ──────────────────────────────────────────────

  describe('calcTax – zero-tax cases', function () {
    it('returns 0 when no categories are provided', function () {
      expect(calcTax(500, 0, [], false)).to.equal(0);
    });

    it('returns 0 when win is below the first tier floor', function () {
      const cats: WinTaxCategory[] = [{ amount: 100, percentage: 20 }];
      expect(calcTax(50, 0, cats, false)).to.equal(0);
    });

    it('returns 0 when win exactly equals the first tier floor', function () {
      const cats: WinTaxCategory[] = [{ amount: 100, percentage: 20 }];
      expect(calcTax(100, 0, cats, false)).to.equal(0);
    });

    it('returns 0 when win is 0', function () {
      const cats: WinTaxCategory[] = [{ amount: 0, percentage: 20 }];
      expect(calcTax(0, 0, cats, false)).to.equal(0);
    });

    it('returns 0 when isDeductible and win ≤ payin (net win ≤ 0)', function () {
      const cats: WinTaxCategory[] = [{ amount: 0, percentage: 20 }];
      expect(calcTax(100, 200, cats, true)).to.equal(0);
    });

    it('returns 0 when isDeductible and win equals payin exactly', function () {
      const cats: WinTaxCategory[] = [{ amount: 0, percentage: 20 }];
      expect(calcTax(150, 150, cats, true)).to.equal(0);
    });
  });

  // ─── calcTax – single tier ─────────────────────────────────────────────────

  describe('calcTax – single tier', function () {
    it('taxes the full amount above the floor', function () {
      // taxBase=200, band=200-100=100, rawTax=100*0.20=20
      const cats: WinTaxCategory[] = [{ amount: 100, percentage: 20 }];
      expect(calcTax(200, 0, cats, false)).to.equal(20);
    });

    it('taxes from floor 0 across the full win amount', function () {
      // taxBase=150, band=150-0=150, rawTax=150*0.20=30
      const cats: WinTaxCategory[] = [{ amount: 0, percentage: 20 }];
      expect(calcTax(150, 0, cats, false)).to.equal(30);
    });

    it('rounds raw tax half-up to whole euros', function () {
      // taxBase=155, band=155, rawTax=155*0.07=10.85 → Math.round=11
      const cats: WinTaxCategory[] = [{ amount: 0, percentage: 7 }];
      expect(calcTax(155, 0, cats, false)).to.equal(11);
    });

    it('rounds raw tax down when fraction < 0.5', function () {
      // taxBase=143, band=143, rawTax=143*0.07=10.01 → Math.round=10
      const cats: WinTaxCategory[] = [{ amount: 0, percentage: 7 }];
      expect(calcTax(143, 0, cats, false)).to.equal(10);
    });
  });

  // ─── calcTax – multi-tier progressive ─────────────────────────────────────

  describe('calcTax – multi-tier progressive bands', function () {
    const cats: WinTaxCategory[] = [
      { amount: 0,   percentage: 5  },
      { amount: 100, percentage: 10 },
      { amount: 500, percentage: 20 },
    ];

    it('applies each tier to its own band for a high win', function () {
      // taxBase=1000
      // band1: min(1000,100)-0   = 100  → 100*0.05 =  5
      // band2: min(1000,500)-100 = 400  → 400*0.10 = 40
      // band3: min(1000,∞)-500  = 500  → 500*0.20 = 100
      // total = 145
      expect(calcTax(1000, 0, cats, false)).to.equal(145);
    });

    it('stops at the correct tier when win falls mid-table', function () {
      // taxBase=300
      // band1: min(300,100)-0   = 100 → 5
      // band2: min(300,500)-100 = 200 → 20
      // band3: 300 ≤ 500 → skipped (wait: 300 > 100 so band2 runs; 300 ≤ 500 so band3 breaks)
      // total = 25
      expect(calcTax(300, 0, cats, false)).to.equal(25);
    });

    it('works when win is just inside the first band', function () {
      // taxBase=50, tiers start at 0; band1: min(50,100)-0=50 → 50*0.05=2.5 → round=3
      expect(calcTax(50, 0, cats, false)).to.equal(3);
    });

    it('handles win exactly at a tier boundary', function () {
      // taxBase=100: band1: min(100,100)-0=100 → 5; band2: taxBase(100) ≤ 100 → break
      // total = 5
      expect(calcTax(100, 0, cats, false)).to.equal(5);
    });

    it('sorts unsorted input categories before applying bands', function () {
      const unsorted: WinTaxCategory[] = [
        { amount: 100, percentage: 10 },
        { amount: 0,   percentage: 5  },
        { amount: 500, percentage: 20 },
      ];
      expect(calcTax(1000, 0, unsorted, false)).to.equal(145);
    });
  });

  // ─── calcTax – isDeductible flag ───────────────────────────────────────────

  describe('calcTax – isDeductible flag', function () {
    const cats: WinTaxCategory[] = [{ amount: 0, percentage: 20 }];

    it('uses net win (win − payin) as tax base when isDeductible=true', function () {
      // taxBase = max(0, 200-50) = 150, band=150, rawTax=30
      expect(calcTax(200, 50, cats, true)).to.equal(30);
    });

    it('uses gross win as tax base when isDeductible=false', function () {
      // taxBase = 200, band=200, rawTax=40
      expect(calcTax(200, 50, cats, false)).to.equal(40);
    });

    it('clamps tax base to 0 when payin exceeds win (isDeductible=true)', function () {
      expect(calcTax(50, 200, cats, true)).to.equal(0);
    });

    it('payin has no effect at all when isDeductible=false', function () {
      expect(calcTax(100, 9999, cats, false)).to.equal(calcTax(100, 0, cats, false));
    });

    it('applies isDeductible correctly across multi-tier bands', function () {
      const multiCats: WinTaxCategory[] = [
        { amount: 0,   percentage: 5  },
        { amount: 100, percentage: 10 },
      ];
      // win=500, payin=200, isDeductible=true → taxBase=300
      // band1: min(300,100)-0=100 → 5
      // band2: min(300,∞)-100=200 → 20
      // total = 25
      expect(calcTax(500, 200, multiCats, true)).to.equal(25);
    });
  });
});
