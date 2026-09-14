"""Independent exact-rational arithmetic check of the specification fixtures.
Not the production engine. Run with Python 3 standard library only.
"""
from fractions import Fraction as F
from pathlib import Path
import json

def ceil(x): return -(-x.numerator//x.denominator)
def fmt(x, places=2):
    sign='-' if x<0 else ''; x=abs(x); scale=10**places
    rounded=(2*x.numerator*scale+x.denominator)//(2*x.denominator)
    return sign+(str(rounded//scale)+'.'+str(rounded%scale).zfill(places) if places else str(rounded))
def price(i):
    cost=F(i['cost']); target=F(i['targetRatio']); raw=cost/(1-target)
    p=None if i['price'] is None else F(i['price'])
    profit=None if p is None else p-cost
    margin=None if p is None or p==0 else profit/p
    status='unpriced' if p is None else 'zero_price' if p==0 else 'below_cost' if profit<0 else 'below_target' if margin<target else 'at_target' if margin==target else 'above_target'
    return dict(profit=None if profit is None else fmt(profit),marginPercent=None if margin is None else fmt(margin*100,1),approxPrice=fmt(raw),minimumPrice=fmt(F(ceil(raw*100),100)),status=status)
def calc(kind,i):
    if kind=='price': return price(i)
    if kind=='job':
        direct=sum(F(i[k]) for k in ['materials','labor','expenses']); overhead=direct*F(i['overheadRatio']); cost=direct+overhead
        return dict(directCost=fmt(direct),overhead=fmt(overhead),cost=fmt(cost),**price(dict(cost=str(cost),price=i['price'],targetRatio=i['targetRatio'])))
    if kind=='interior':
        l,w,h=map(F,[i['length'],i['width'],i['height']]); gross=2*(l+w)*h
        deduct=i['doorCount']*F(i['doorArea'])+i['windowCount']*F(i['windowArea']); net=gross-deduct
        ceiling=l*w if i['includeCeiling'] else F(0); area=net+ceiling; coated=area*i['coats']
        raw=coated*(1+F(i['wasteRatio']))/F(i['coverage']); purchase=ceil(raw); paint=purchase*F(i['paintPrice'])
        hours=net*i['coats']/F(i['wallRate'])+ceiling*i['coats']/F(i['ceilingRate']); labor=hours*F(i['laborRate'])
        return dict(grossArea=fmt(gross),deduction=fmt(deduct),netWall=fmt(net),totalArea=fmt(area),coatArea=fmt(coated),rawGallons=fmt(raw,6),purchaseGallons=purchase,paintCost=fmt(paint),hours=fmt(hours,6),laborCost=fmt(labor),totalCost=fmt(paint+labor))
    if kind=='document':
        lines=[fmt(F(q)*F(p)) for q,p in i['lines']]; sub=sum(F(x) for x in lines); tax=F(fmt(sub*F(i['taxRatio'])))
        return dict(lines=lines,subtotal=fmt(sub),tax=fmt(tax),total=fmt(sub+tax))
    if kind=='paint':
        grouped={}
        for variant,demand in i['demands']: grouped[variant]=grouped.get(variant,F(0))+F(demand)
        purchases={k:ceil(v) for k,v in grouped.items()}; cost=sum(v*F(i['prices'][k]) for k,v in purchases.items())
        return dict(purchases=purchases,paintCost=fmt(cost))
    if kind=='service':
        paint=F(i['areaPerUnit'])*i['coats']*(1+F(i['wasteRatio']))/F(i['coverage'])*F(i['paintPrice'])
        labor=(F(i['applicationHours'])+F(i['additionalHours']))*F(i['laborRate'])
        cost=(paint+labor+F(i['supplies'])+F(i['expenses']))*(1+F(i['overheadRatio']))
        return dict(paintPerUnit=fmt(paint,6),laborPerUnit=fmt(labor,6),costPerUnit=fmt(cost,6),**price(dict(cost=str(cost),price=i['price'],targetRatio=i['targetRatio'])))
    if kind=='surface':
        if i['surfaceKind']=='trim':
            area=F(i['length'])*F(i['developedWidth']); hours=F(i['length'])*i['coats']/F(i['throughput'])
        else:
            area=i['count']*F(i['width'])*F(i['height'])*i['sides']; hours=i['count']*i['sides']*i['coats']*F(i['hoursPerSidePerCoat'])
        raw=area*i['coats']*(1+F(i['wasteRatio']))/F(i['coverage']); purchased=ceil(raw)
        return dict(area=fmt(area),rawGallons=fmt(raw,6),purchasedGallons=purchased,hours=fmt(hours,6),laborCost=fmt(hours*F(i['laborRate'])),paintCost=fmt(purchased*F(i['paintPrice'])))
    if kind=='actual':
        cost=sum(F(i[k]) for k in ['materials','labor','expenses','overhead']); profit=F(i['baselinePrice'])-cost
        return dict(actualCost=fmt(cost),profit=fmt(profit),marginPercent=fmt(profit/F(i['baselinePrice'])*100,1) if F(i['baselinePrice'])>0 else None,totalVariance=fmt(cost-F(i['baselineCost'])))
    raise ValueError(kind)

def main():
    cases=json.loads(Path(__file__).with_name('acceptance-fixtures.json').read_text())['cases']; assertions=0
    for c in cases:
        got=calc(c['kind'],c['input'])
        for key,value in c['expected'].items():
            assert got[key]==value,(c['id'],key,'expected',value,'got',got[key]); assertions+=1
        print('PASS',c['id'])
    print(f'{len(cases)} numerical fixtures, {assertions} expected fields passed. Production implementation and lifecycle tests remain required.')
if __name__=='__main__': main()
