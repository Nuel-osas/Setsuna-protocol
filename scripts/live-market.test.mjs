import {test} from 'node:test';
import assert from 'node:assert/strict';
import {perplLevels, perplCandles, kuruCandles} from '../src/lib/setsuna/live-market.ts';
test('Perpl price and size scale independently; BTC quantities remain BTC',()=>{
  assert.deepEqual(perplLevels([{p:859055,s:6492},{p:859100,s:10000}],1,5,true),[{price:85910,size:.1,total:.1},{price:85905.5,size:.06492,total:.16492}]);
  assert.deepEqual(perplCandles({d:[{t:1791181800000,o:859000,h:859500,l:858900,c:859055}]},1),[{time:1791181800000,open:85900,high:85950,low:85890,close:85905.5}]);
});
test('Kuru timestamps convert seconds to milliseconds and prices remain unscaled',()=>{
  const d={s:'ok',t:[1791181800],o:['.034565'],h:['.034542'],l:['.034312'],c:['.034361']};
  const [c]=kuruCandles({success:true,data:{data:d}});
  assert.equal(c.time,1791181800000);assert.equal(c.close,.034361);
  // Kuru can report opens outside H/L. Preserve source data; UI plots closes only.
  assert.equal(c.open,.034565);assert.equal(c.high,.034542);
});
test('bad data cannot become plausible chart prices',()=>{
  for(const value of [null,'',NaN,Infinity,-2]) assert.throws(()=>perplLevels([{p:value,s:1}],1,5,true));
  assert.throws(()=>perplCandles({d:[{t:123,o:10,h:9,l:8,c:9}]},1));
  assert.throws(()=>kuruCandles({success:true,data:{data:{s:'ok',t:[1],o:[],h:[],l:[],c:[]}}}));
  assert.throws(()=>perplCandles({d:[{t:1,o:10,h:10,l:10,c:10},{t:1,o:10,h:10,l:10,c:10}]},1));
});

test('Kuru trade prices derive from MON and USDC amounts, exclude maker duplicates and unpriced dust',async()=>{
  const {kuruTrades}=await import('../src/lib/setsuna/live-market.ts');
  const row={marketAddress:'0x065c9d28e428a0db40191a54d33d5b7c71a9c394',baseAsset:'0x0000000000000000000000000000000000000000',quoteAsset:'0x754704bc059f8c67012fed69bc8a327a5aafb603',baseDecimals:18,isBuy:true,isMaker:false,transactionHash:'0x'+'a'.repeat(64),baseAmount:'2000000000000000000',quoteAmount:'65000',blockTimestamp:'2026-10-05T08:00:00Z',logIndex:1};
  const wrap=data=>({success:true,data:{data}});
  const trades=kuruTrades(wrap([row,{...row,isMaker:true},{...row,quoteAmount:'0'}]));
  assert.equal(trades.length,1);assert.equal(trades[0].size,2);assert.equal(trades[0].price,.0325);
  assert.throws(()=>kuruTrades(wrap([{...row,quoteAsset:row.baseAsset}])));
  assert.throws(()=>kuruTrades(wrap([{...row,baseAmount:'-1'}])));
});
