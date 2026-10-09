#!/usr/bin/env python3
"""Hane 0.3: the text cut of the family — hairlines widened to survive 9-15 px
interface rendering, where the high-contrast 0.2 display cut breaks up.
Core Latin outlines are original vector constructions, not traced font data.
Feather terminals and the hand-drawn h/a/n/e/m/r/l/i contours carry the identity;
SemiBold adds a real title weight. Those contours are expanded per style so they
keep pace with the nib-expanded letters.
"""
from pathlib import Path
import math, unicodedata, json
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.areaPen import AreaPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont
import build_hane as base

ROOT=Path(__file__).resolve().parent
OUT=ROOT.parent.parent/'Hane-v0.3'
OUT.mkdir(exist_ok=True)
design=base.design.copy()
custom={}

# Optical density ladder per style: (usWeightClass, stem half-width,
# hairline half-width, extra stroke width on the hand-drawn contours).
# 0.3 is the text cut of the family: the hairline is widened to survive 9-15 px
# grayscale antialiasing (~0.7-1.0 px), which flattens the 0.2 display contrast
# while keeping the feather terminals and the drawn h/a/n/e/m/r/l/i forms.
STYLES={'Regular':(400,45,27,24),'Medium':(500,52,33,30),'SemiBold':(600,61,40,42)}

def C(a,b,c):return ('C',a,b,c)
def L(p):return ('L',p)
def shape(c,w,*contours):custom[c]=(w,list(contours))
def closed(start,*commands):return [start,*commands]

# Ascender terminates in a feather-like wedge. The shoulder is a continuous
# contour with an intentional taper, rather than overlapping round strokes.
shape('h',640,closed((75,0),L((75,669)),C((75,740),(60,769),(35,784)),
 C((119,786),(143,729),(158,628)),L((138,561)),C((130,499),(132,430),(132,367)),
 C((169,530),(390,574),(509,452)),C((551,409),(565,349),(565,279)),
 L((565,0)),L((491,0)),L((491,288)),C((491,427),(444,493),(332,496)),
 C((207,500),(140,405),(132,266)),L((132,0))))
shape('n',640,closed((75,0),L((75,271)),C((75,413),(169,519),(333,519)),
 C((492,519),(565,438),(565,280)),L((565,0)),L((491,0)),L((491,289)),
 C((491,432),(437,499),(333,499)),C((192,499),(93,373),(93,250)),L((93,0))))
shape('a',635,closed((65,372),C((118,553),(496,590),(550,408)),
 C((564,364),(560,293),(560,238)),L((560,0)),L((514,0)),
 C((484,6),(489,54),(486,78)),C((436,-5),(363,-11),(288,-11)),
 C((127,-11),(56,53),(56,145)),C((56,261),(191,307),(336,310)),
 C((451,313),(492,327),(492,365)),C((492,435),(406,489),(292,489)),
 C((191,489),(102,438),(65,372))),
 closed((488,311),C((446,279),(372,290),(300,278)),C((158,256),(138,221),(138,142)),
 C((138,34),(253,7),(329,15)),C((440,26),(488,88),(488,201)),L((488,311))))
shape('e',645,closed((563,127),C((514,-27),(221,-57),(109,77)),
 C((17,193),(60,397),(177,472)),C((330,574),(546,501),(575,331)),
 C((580,304),(580,289),(573,273)),C((403,260),(278,278),(145,296)),
 C((134,127),(221,7),(356,9)),C((435,11),(510,58),(563,127))),
 closed((151,310),C((169,417),(235,493),(333,493)),
 C((461,493),(519,409),(507,287)),C((356,278),(233,304),(151,310))))

# Related shoulders and bowls propagate the identity to the complete alphabet.
shape('m',950,closed((75,0),L((75,271)),C((75,413),(168,518),(303,518)),
 C((400,518),(457,463),(478,371)),C((523,472),(598,518),(692,518)),
 C((826,518),(875,433),(875,280)),L((875,0)),L((803,0)),L((803,290)),
 C((803,439),(763,499),(688,499)),C((573,499),(493,402),(493,250)),
 L((493,0)),L((421,0)),L((421,290)),C((421,439),(379,499),(301,499)),
 C((190,499),(93,373),(93,250)),L((93,0))))
shape('r',410,closed((75,0),L((75,500)),L((93,500)),L((93,344)),
 C((118,472),(231,544),(348,502)),L((347,439)),
 C((266,514),(116,447),(132,258)),L((132,0))))
shape('l',260,closed((95,0),L((95,670)),C((95,737),(79,771),(55,784)),
 C((139,786),(161,729),(172,633)),L((152,563)),L((152,0))))
shape('i',260,closed((100,0),L((100,500)),L((160,500)),L((160,0))))

def contrast_expand(pen,pts,thick,thin,closed_path=False,taper=False):
    # An elliptical nib creates vertical stress and flat terminals.
    pts=[p for i,p in enumerate(pts) if i==0 or p!=pts[i-1]]
    if closed_path and pts[-1]==pts[0]:pts=pts[:-1]
    if not taper:
        import pathops
        p=pathops.Path();q=p.getPen()
        q.moveTo((pts[0][0]/thick,pts[0][1]/thin))
        for x,y in pts[1:]:q.lineTo((x/thick,y/thin))
        if closed_path:q.closePath()
        else:q.endPath()
        p.stroke(2,pathops.LineCap.BUTT_CAP,pathops.LineJoin.ROUND_JOIN,4)
        p=p.transform(thick,0,0,thin,0,0)
        p.convertConicsToQuads(.5)
        p=pathops.simplify(p,clockwise=True)
        p.draw(Cu2QuPen(pen,max_err=.6))
        return
    n=len(pts);normals=[]
    for i in range(n if closed_path else n-1):
        p,q=pts[i],pts[(i+1)%n];dx=(q[0]-p[0])/thick;dy=(q[1]-p[1])/thin;length=math.hypot(dx,dy)
        normals.append((-dy/length,dx/length))
    left=[];right=[]
    for i,p in enumerate(pts):
        factor=1
        if not closed_path and i==0:nx,ny=normals[0]
        elif not closed_path and i==n-1:nx,ny=normals[-1]
        else:
            a=normals[(i-1)%len(normals)];b=normals[i%len(normals)]
            nx,ny=a[0]+b[0],a[1]+b[1];length=math.hypot(nx,ny)
            if length<1e-7:nx,ny=b
            else:
                nx/=length;ny/=length
                factor=min(3.5,1/max(.01,nx*b[0]+ny*b[1]))
        dx=nx*factor*thick;dy=ny*factor*thin
        if taper and not closed_path:
            scale=min(1,0.10+min(i,n-i-1)/max(1,n*.10))
            dx*=scale;dy*=scale
        left.append((p[0]+dx,p[1]+dy));right.append((p[0]-dx,p[1]-dy))
    if closed_path:
        area=sum(pts[i][0]*pts[(i+1)%n][1]-pts[(i+1)%n][0]*pts[i][1] for i in range(n))
        base.contour(pen,right if area>0 else left,True)
        base.contour(pen,left if area>0 else right,False)
    else:base.contour(pen,left+list(reversed(right)),True)

def outline(pen,commands,hole=False,dx=0,dy=0,medium=False):
    # Keep true cubic paths in source; approximate with quadratic curves at <1 em unit.
    rec=RecordingPen();rec.moveTo(commands[0])
    for cmd in commands[1:]:
        if cmd[0]=='L':rec.lineTo(cmd[1])
        else:rec.curveTo(*cmd[1:])
    rec.closePath();area=AreaPen();rec.replay(area)
    target=Cu2QuPen(pen,max_err=.6,reverse_direction=False)
    if (area.value>0)!=(hole):target=ReverseContourPen(target)
    rec.replay(target)

def name(c):return base.name(c)

def base_custom(c):
    d=unicodedata.normalize('NFD',c)
    if c in custom:return c,None
    if len(d)==2 and d[0] in custom and base.accent(d[1],0,0):return d[0],d[1]
    return None,None

def draw_glyph(c,thick,thin,expand):
    pen=TTGlyphPen(None)
    accent_stroke=max(14,round(thick*.42))
    key,mark=base_custom(c)
    if key:
        w,contours=custom[key]
        for i,commands in enumerate(contours):outline(pen,commands,hole=i>0)
        if key=='i' and not mark:
            base.contour(pen,base.ellipse(130,645,23,23),True)
        if mark:
            top=784 if key in 'hl' else 520
            for p in base.accent(mark,w/2,top) or []:
                if isinstance(p,tuple) and p[0]=='dot':
                    x,y,r=p[1];base.contour(pen,base.ellipse(x,y,23,23),True)
                elif isinstance(p,tuple) and p[0]=='closed':contrast_expand(pen,p[1],accent_stroke,thin,True)
                else:contrast_expand(pen,p,accent_stroke,thin)
    else:
        w,paths=design[c]
        for p in paths:
            if isinstance(p,tuple) and p[0]=='dot':
                x,y,r=p[1];base.contour(pen,base.ellipse(x,y,r*.8,r*.8),True)
            elif isinstance(p,tuple) and p[0]=='closed':contrast_expand(pen,p[1],thick,thin,True)
            else:
                taper=c in 'cCsSfgjtuyß' and len(p)>10
                contrast_expand(pen,p,thick,thin,taper=taper)
    glyph=pen.glyph()
    if key and expand:
        import pathops
        original=pathops.Path();glyph.draw(original.getPen(),None)
        border=pathops.Path();original.draw(border.getPen())
        border.stroke(expand,pathops.LineCap.BUTT_CAP,pathops.LineJoin.ROUND_JOIN,4)
        border.convertConicsToQuads(.5)
        merged=pathops.op(original,border,pathops.PathOp.UNION,clockwise=True)
        weighted=TTGlyphPen(None);merged.draw(Cu2QuPen(weighted,max_err=.6))
        glyph=weighted.glyph()
    if glyph.numberOfContours>0:glyph.flags[0]|=0x40
    return w,glyph

def build(style,weight,thick,thin,expand):
    fb=FontBuilder(1000,isTTF=True)
    order=['.notdef']+[name(c) for c in sorted(design,key=ord)]
    fb.setupGlyphOrder(order);glyphs={};metrics={}
    p=TTGlyphPen(None);base.contour(p,[(75,0),(75,700),(500,700),(500,0)],True)
    base.contour(p,[(100,25),(100,675),(475,675),(475,25)],False)
    glyphs['.notdef']=p.glyph();metrics['.notdef']=(580,75)
    for c in sorted(design,key=ord):
        w,g=draw_glyph(c,thick,thin,expand);glyphs[name(c)]=g;metrics[name(c)]=(w,0)
    fb.setupGlyf(glyphs)
    for g in glyphs:
        glyphs[g].recalcBounds(fb.font['glyf'])
        metrics[g]=(metrics[g][0],getattr(glyphs[g],'xMin',0))
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=1100,descent=-300,lineGap=0)
    fb.setupCharacterMap({ord(c):name(c) for c in design})
    fb.setupNameTable({'familyName':'Hane Sans' if style=='Regular' else 'Hane Sans '+style,
     'styleName':'Regular','uniqueFontIdentifier':f'HaneSans-0.300-{style}',
     'fullName':f'Hane Sans {style}','psName':f'HaneSans-{style}','version':'Version 0.300',
     'typographicFamily':'Hane Sans','typographicSubfamily':style,'manufacturer':'Hane',
     'designer':'Hane / Lucas Frischeisen',
     'description':'Soft luxury typeface for Hane. Feather terminals. Text cut with UI-sturdy hairlines. Prototype 0.3.'})
    fb.setupOS2(version=4,sTypoAscender=1100,sTypoDescender=-300,sTypoLineGap=0,
     usWinAscent=1100,usWinDescent=300,usWeightClass=weight,fsType=0,
     sxHeight=500,sCapHeight=700,fsSelection=0x40|0x80)
    fb.setupPost();fb.setupMaxp();fb.font['head'].fontRevision=.3
    pairs={'AV':-65,'AW':-45,'AY':-65,'AT':-40,'TA':-40,'To':-45,'Ta':-45,'Te':-45,
      'Tr':-25,'Ty':-25,'Va':-35,'Vo':-35,'Ve':-35,'Wa':-25,'Wo':-25,'Ya':-60,
      'Yo':-60,'Ye':-60,'LT':-35,'LY':-45,'FA':-25,'Pa':-20,'Po':-20,'ry':-10,'rv':-10,
      'ha':-15,'an':-12,'ne':-10,'na':-10,'ea':-8,'nn':-10}
    rules='\n'.join(f'pos {name(a)} {name(b)} {v};' for (a,b),v in pairs.items())
    addOpenTypeFeaturesFromString(fb.font,'languagesystem DFLT dflt; languagesystem latn dflt; feature kern {\n'+rules+'\n} kern;')
    # Remove intersections so contour winding is robust in more font consumers.
    from fontTools.ttLib.removeOverlaps import removeOverlaps
    removeOverlaps(fb.font,removeHinting=True,ignoreErrors=False)
    fb.save(OUT/f'HaneSans-{style}.ttf')
    f=TTFont(OUT/f'HaneSans-{style}.ttf');f.flavor='woff2';f.save(OUT/f'HaneSans-{style}.woff2')

if __name__=='__main__':
    for style,(weight,thick,thin,expand) in STYLES.items():
        build(style,weight,thick,thin,expand)
    print(json.dumps({'glyphs':len(design)+1,'styles':list(STYLES),'out':str(OUT)}))
