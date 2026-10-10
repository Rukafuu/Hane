#!/usr/bin/env python3
"""Hane Sans 0.1: original centerline drawings expanded to TrueType outlines.
No outlines are read from an existing font. Coordinates use a 1000-unit em.
"""
from pathlib import Path
import math, unicodedata, json, base64, zipfile
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'Hane-Sans-v0.1'
OUT.mkdir(exist_ok=True)

def curve(start, *segments):
    pts=[start]
    for seg in segments:
        if len(seg)==2:
            pts.append(seg); continue
        p0=pts[-1]; p1,p2,p3=seg
        for i in range(1,25):
            t=i/24; u=1-t
            pts.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],
                        u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return pts

def ellipse(cx,cy,rx,ry):
    return [(cx+rx*math.cos(t*2*math.pi/96),cy+ry*math.sin(t*2*math.pi/96)) for t in range(96)]

design={}
def put(c,w,*paths): design[c]=(w,list(paths))
def line(*pts): return list(pts)
def oval(cx=270,cy=250,rx=190,ry=250): return ('closed',ellipse(cx,cy,rx,ry))
stem=lambda x,y0=0,y1=500: line((x,y0),(x,y1))

# Lowercase: open apertures, softened shoulders and a restrained, low crossbar.
put('a',560,oval(),stem(460))
put('b',560,stem(85,0,720),curve((85,350),((120,565),(460,565),(460,250)),((460,-65),(120,-65),(85,150))))
put('c',510,curve((435,420),((355,565),(75,535),(75,250)),((75,-35),(350,-65),(440,90))))
put('d',560,oval(),stem(460,0,720))
put('e',530,curve((80,250),(450,250),((455,570),(70,590),(75,250)),((80,-35),(355,-70),(450,85))))
put('f',340,curve((125,0),(125,565),((125,710),(225,760),(310,710))),line((55,490),(290,490)))
put('g',560,oval(),curve((460,500),(460,-55),((460,-235),(235,-260),(110,-150))))
put('h',560,stem(85,0,720),curve((85,335),((130,570),(460,565),(460,285)),(460,0)))
put('i',240,stem(120),('dot',(120,655,31)))
put('j',260,curve((150,500),(150,-95),((150,-205),(80,-235),(25,-185))),('dot',(150,655,31)))
put('k',510,stem(85,0,720),line((445,500),(95,190)),line((255,333),(465,0)))
put('l',260,curve((100,720),(100,85),((100,15),(135,-10),(185,10))))
put('m',840,stem(85),curve((85,330),((120,550),(400,570),(400,290)),(400,0)),curve((400,330),((445,550),(755,570),(755,285)),(755,0)))
put('n',560,stem(85),curve((85,335),((130,570),(460,565),(460,285)),(460,0)))
put('o',540,oval())
put('p',560,stem(85,-210,500),curve((85,350),((120,565),(460,565),(460,250)),((460,-65),(120,-65),(85,150))))
put('q',560,oval(),stem(460,-210,500))
put('r',370,stem(85),curve((85,320),((130,500),(245,550),(315,475))))
put('s',490,curve((410,415),((340,535),(90,530),(90,390)),((90,240),(410,285),(410,120)),((410,-30),(155,-55),(75,85))))
put('t',360,curve((130,655),(130,135),((130,5),(220,-40),(305,30))),line((55,490),(295,490)))
put('u',560,curve((85,500),(85,200),((85,-65),(405,-65),(460,160))),stem(460))
put('v',500,line((65,500),(250,0),(435,500)))
put('w',740,line((65,500),(200,0),(370,420),(540,0),(675,500)))
put('x',490,line((65,500),(425,0)),line((425,500),(65,0)))
put('y',500,line((65,500),(250,35)),curve((435,500),(240,-30),((190,-180),(135,-220),(60,-200))))
put('z',490,line((75,500),(415,500),(75,0),(425,0)))

# Capitals share the soft round geometry but retain conventional proportions.
put('A',650,line((65,0),(325,700),(585,0)),line((150,230),(500,230)))
put('B',630,line((95,0),(95,700),(305,700)),curve((305,700),((610,700),(605,365),(310,365)),(95,365)),curve((310,365),((650,365),(645,0),(305,0)),(95,0)))
put('C',650,curve((565,585),((430,795),(80,735),(80,350)),((80,-35),(430,-95),(570,115))))
put('D',660,line((95,0),(95,700),(290,700)),curve((290,700),((675,700),(675,0),(290,0)),(95,0)))
put('E',560,line((490,700),(95,700),(95,0),(500,0)),line((95,355),(435,355)))
put('F',540,line((95,0),(95,700),(490,700)),line((95,355),(420,355)))
put('G',700,curve((600,585),((445,795),(80,735),(80,350)),((80,-55),(480,-75),(605,125)),(605,310),(385,310)))
put('H',680,stem(95,0,700),stem(585,0,700),line((95,355),(585,355)))
put('I',280,stem(140,0,700),line((75,700),(205,700)),line((75,0),(205,0)))
put('J',510,curve((420,700),(420,190),((420,-60),(110,-75),(75,140))))
put('K',620,stem(95,0,700),line((550,700),(100,275)),line((290,455),(565,0)))
put('L',540,line((95,700),(95,0),(485,0)))
put('M',840,line((95,0),(95,700),(420,210),(745,700),(745,0)))
put('N',700,line((95,0),(95,700),(605,0),(605,700)))
put('O',720,('closed',ellipse(360,350,280,360)))
put('P',600,line((95,0),(95,700),(300,700)),curve((300,700),((635,700),(635,350),(300,350)),(95,350)))
put('Q',720,('closed',ellipse(360,350,280,360)),line((420,160),(650,-90)))
put('R',630,line((95,0),(95,700),(300,700)),curve((300,700),((635,700),(635,350),(300,350)),(95,350)),line((310,350),(565,0)))
put('S',610,curve((520,590),((395,785),(95,715),(95,545)),((95,315),(520,420),(520,180)),((520,-45),(210,-75),(75,100))))
put('T',620,line((65,700),(555,700)),stem(310,0,700))
put('U',680,curve((95,700),(95,250),((95,-100),(585,-100),(585,250)),(585,700)))
put('V',640,line((65,700),(320,0),(575,700)))
put('W',940,line((65,700),(255,0),(470,560),(685,0),(875,700)))
put('X',640,line((65,700),(575,0)),line((575,700),(65,0)))
put('Y',630,line((65,700),(315,355),(565,700)),stem(315,0,355))
put('Z',620,line((85,700),(545,700),(75,0),(545,0)))

# Figures: proportional, with an angled flag on 1 and a deliberately open 4.
put('0',580,('closed',ellipse(290,350,205,355)))
put('1',380,line((80,555),(205,700),(205,0)),line((80,0),(310,0)))
put('2',580,curve((85,545),((125,770),(495,755),(495,550)),((495,370),(120,255),(85,0)),(500,0)))
put('3',580,curve((95,600),((230,800),(505,705),(485,535)),((475,405),(380,365),(280,365)),((550,395),(575,0),(305,0)),((195,-10),(110,40),(75,125))))
put('4',590,line((370,700),(75,230),(520,230)),stem(415,0,510))
put('5',580,curve((495,700),(125,700),(110,380),((300,485),(500,415),(500,210)),((500,-40),(190,-65),(80,100))))
put('6',580,curve((480,625),((325,820),(85,670),(85,270)),((85,-80),(500,-95),(500,215)),((500,500),(155,460),(90,250))))
put('7',550,line((65,700),(490,700),(205,0)))
put('8',580,('closed',ellipse(290,530,190,175)),('closed',ellipse(290,175,215,185)))
put('9',580,curve((100,75),((255,-115),(495,30),(495,430)),((495,780),(80,795),(80,485)),((80,200),(425,240),(490,450))))

put(' ',270); put('\u00a0',270)
put('.',230,('dot',(115,20,31))); put(',',230,curve((130,25),((155,-30),(115,-95),(75,-110))))
put(':',230,('dot',(115,20,31)),('dot',(115,390,31)))
put(';',230,('dot',(115,390,31)),curve((130,25),((155,-30),(115,-95),(75,-110))))
put('!',260,stem(130,180,700),('dot',(130,20,31)))
put('?',510,curve((75,550),((110,755),(430,750),(430,555)),((430,430),(255,410),(255,225)),(255,175)),('dot',(255,20,31)))
put('-',370,line((75,270),(295,270)))
put('–',570,line((65,270),(505,270))); put('—',890,line((65,270),(825,270)))
put('_',600,line((55,-115),(545,-115)))
put('+',600,line((75,300),(525,300)),stem(300,75,525))
put('=',600,line((75,195),(525,195)),line((75,405),(525,405)))
put('/',440,line((65,-110),(375,765))); put('\\',440,line((65,765),(375,-110)))
put('|',230,stem(115,-160,780))
put('(',330,curve((250,770),((20,520),(20,90),(250,-160))))
put(')',330,curve((80,770),((310,520),(310,90),(80,-160))))
put('[',340,line((265,770),(115,770),(115,-160),(265,-160)))
put(']',340,line((75,770),(225,770),(225,-160),(75,-160)))
put('{',370,curve((285,770),((130,790),(165,640),(165,525)),((165,380),(100,325),(75,305)),((100,280),(165,230),(165,85)),((165,-30),(130,-180),(285,-160))))
put('}',370,curve((85,770),((240,790),(205,640),(205,525)),((205,380),(270,325),(295,305)),((270,280),(205,230),(205,85)),((205,-30),(240,-180),(85,-160))))
put('<',570,line((485,535),(85,300),(485,65)))
put('>',570,line((85,535),(485,300),(85,65)))
put('"',350,stem(115,525,700),stem(235,525,700))
put("'",230,stem(115,525,700)); put('`',290,line((75,720),(215,585)))
put('^',460,line((75,495),(230,700),(385,495)))
put('~',580,curve((70,285),((190,440),(365,155),(510,310))))
put('*',420,line((210,700),(210,385)),line((60,620),(360,465)),line((60,465),(360,620)))
put('#',650,line((235,700),(155,0)),line((495,700),(415,0)),line((65,230),(570,230)),line((85,475),(590,475)))
put('$',610,*design['S'][1],stem(300,-100,800))
put('%',780,('closed',ellipse(185,545,110,145)),('closed',ellipse(595,150,110,145)),line((120,0),(660,700)))
put('&',700,curve((610,20),(235,425),((50,610),(245,825),(380,655)),((525,480),(70,315),(90,130)),((110,-105),(510,-95),(605,305))))
put('@',900,('closed',ellipse(465,320,345,365)),('closed',ellipse(460,310,155,180)),curve((615,490),(615,205),((625,80),(810,145),(810,330))))
put('…',650,('dot',(110,20,31)),('dot',(325,20,31)),('dot',(540,20,31)))
put('·',230,('dot',(115,270,31)))
put('°',330,('closed',ellipse(165,610,85,85)))
put('€',660,*design['C'][1],line((45,420),(465,420)),line((45,275),(440,275)))
put('£',600,curve((515,615),((415,775),(175,735),(175,550)),(175,120),((175,30),(110,0),(70,0)),(525,0)),line((75,350),(400,350)))
put('¥',630,*design['Y'][1],line((135,290),(495,290)),line((135,155),(495,155)))
put('©',900,('closed',ellipse(450,350,350,365)),curve((600,490),((445,655),(255,520),(255,350)),((255,160),(450,50),(600,210))))
put('®',900,('closed',ellipse(450,350,350,365)),line((320,130),(320,565),(440,565)),curve((440,565),((650,565),(650,350),(440,350)),(320,350)),line((440,350),(600,130)))
for c,base in [('‘',"'"),('’',"'"),('‚',','),('“','"'),('”','"'),('„','"')]:
    w,paths=design[base]; put(c,w,*paths)
put('¡',260,stem(130,-180,340),('dot',(130,500,31)))
put('¿',510,curve((435,-55),((400,-260),(80,-255),(80,-60)),((80,65),(255,85),(255,270)),(255,320)),('dot',(255,500,31)))
put('«',570,line((265,485),(65,270),(265,55)),line((505,485),(305,270),(505,55)))
put('»',570,line((65,485),(265,270),(65,55)),line((305,485),(505,270),(305,55)))
put('×',600,line((105,80),(495,520)),line((105,520),(495,80)))
put('÷',600,line((75,300),(525,300)),('dot',(300,90,31)),('dot',(300,510,31)))
for c in ['←','→','↑','↓']:
    if c=='→': paths=[line((75,300),(675,300)),line((480,500),(675,300),(480,100))]
    if c=='←': paths=[line((75,300),(675,300)),line((270,500),(75,300),(270,100))]
    if c=='↑': paths=[line((375,0),(375,600)),line((175,405),(375,600),(575,405))]
    if c=='↓': paths=[line((375,0),(375,600)),line((175,195),(375,0),(575,195))]
    put(c,750,*paths)

def accent(mark,cx,top):
    y=top+105
    return {
        '\u0301':[line((cx-55,y),(cx+65,y+100))],
        '\u0300':[line((cx+55,y),(cx-65,y+100))],
        '\u0302':[line((cx-110,y),(cx,y+95),(cx+110,y))],
        '\u0303':[curve((cx-120,y+25),((cx-35,y+120),(cx+35,y-60),(cx+120,y+35)))],
        '\u0308':[('dot',(cx-83,y+35,28)),('dot',(cx+83,y+35,28))],
        '\u030a':[('closed',ellipse(cx,y+50,62,62))],
        '\u030c':[line((cx-110,y+95),(cx,y),(cx+110,y+95))],
        '\u0304':[line((cx-105,y+45),(cx+105,y+45))],
        '\u0306':[curve((cx-110,y+85),((cx-70,y-20),(cx+70,y-20),(cx+110,y+85)))],
        '\u0327':[curve((cx,0),(cx-35,-55),((cx+135,-65),(cx+50,-205),(cx-65,-145)))],
        '\u0328':[curve((cx+90,0),((cx-20,-95),(cx+25,-195),(cx+120,-130)))],
        '\u0307':[('dot',(cx,y+35,28))],
    }.get(mark)

# Composed Latin glyphs cover Portuguese and most Western/Central European text.
for cp in range(0xC0,0x180):
    c=chr(cp); decomp=unicodedata.normalize('NFD',c)
    if len(decomp)==2 and decomp[0] in design:
        base,mark=decomp; w,paths=design[base]
        top=700 if base.isupper() else (720 if base in 'bdfhkl' else (655 if base=='t' else 500))
        a=accent(mark,w/2,top)
        if a:
            paths=list(paths)
            if base=='i': paths=[stem(120)]
            put(c,w,*(paths+a))
put('ß',570,curve((85,0),(85,490),((85,760),(470,735),(410,535)),((385,465),(280,400),(275,375)),((580,260),(570,-35),(270,15))))
put('ø',540,*design['o'][1],line((75,-50),(465,550)))
put('Ø',720,*design['O'][1],line((90,-50),(630,750)))
put('æ',850,*design['a'][1],curve((460,250),(775,250),((790,555),(450,575),(460,250)),((470,-40),(695,-45),(780,70))))
put('Æ',960,line((65,0),(365,700),(540,700),(540,0)),line((165,230),(540,230)),line((540,700),(885,700)),line((540,355),(845,355)),line((540,0),(895,0)))
put('œ',880,*design['o'][1],curve((460,250),(805,250),((810,560),(450,570),(460,250)),((470,-40),(725,-45),(815,70))))
put('Œ',1060,*design['O'][1],line((640,700),(985,700)),line((640,355),(945,355)),line((640,0),(995,0)))
put('ﬁ',580,*design['f'][1],stem(460),('dot',(460,655,31)))
put('ﬂ',600,*design['f'][1],curve((460,720),(460,85),((460,15),(495,-10),(545,10))))

def contour(pen,pts,clockwise=True):
    # TrueType expects clockwise exterior contours and counter-clockwise holes.
    area=sum(pts[i][0]*pts[(i+1)%len(pts)][1]-pts[(i+1)%len(pts)][0]*pts[i][1] for i in range(len(pts)))
    if (area>0)==clockwise: pts=list(reversed(pts))
    pen.moveTo(tuple(round(x) for x in pts[0]))
    for p in pts[1:]: pen.lineTo(tuple(round(x) for x in p))
    pen.closePath()

def expand(pen,pts,r,closed=False):
    n=len(pts)
    normals=[]
    for i in range(n if closed else n-1):
        p,q=pts[i],pts[(i+1)%n]; dx=q[0]-p[0];dy=q[1]-p[1];l=math.hypot(dx,dy)
        normals.append((-dy/l,dx/l))
    left=[]; right=[]
    for i,p in enumerate(pts):
        if not closed and i==0: nx,ny=normals[0]; factor=r
        elif not closed and i==n-1: nx,ny=normals[-1]; factor=r
        else:
            a=normals[(i-1)%len(normals)];b=normals[i%len(normals)]
            nx,ny=a[0]+b[0],a[1]+b[1]; l=math.hypot(nx,ny)
            nx/=l;ny/=l;factor=min(r/max(nx*b[0]+ny*b[1],0.1),r*2.4)
        left.append((p[0]+nx*factor,p[1]+ny*factor))
        right.append((p[0]-nx*factor,p[1]-ny*factor))
    if closed:
        area=sum(pts[i][0]*pts[(i+1)%n][1]-pts[(i+1)%n][0]*pts[i][1] for i in range(n))
        contour(pen,right if area>0 else left,True)
        contour(pen,left if area>0 else right,False)
    else:
        end=pts[-1]; start=pts[0]
        a=math.atan2(normals[-1][1],normals[-1][0])
        cap1=[(end[0]+r*math.cos(a-j*math.pi/12),end[1]+r*math.sin(a-j*math.pi/12)) for j in range(1,12)]
        a=math.atan2(-normals[0][1],-normals[0][0])
        cap2=[(start[0]+r*math.cos(a-j*math.pi/12),start[1]+r*math.sin(a-j*math.pi/12)) for j in range(1,12)]
        contour(pen,left+cap1+list(reversed(right))+cap2,True)

def name(c): return 'uni%04X'%ord(c)

def build(style,stroke,weight):
    order=['.notdef']+[name(c) for c in sorted(design,key=ord)]
    fb=FontBuilder(1000,isTTF=True);fb.setupGlyphOrder(order)
    glyphs={};metrics={}
    shapes={'.notdef':(620,[line((95,0),(95,700),(525,700),(525,0),(95,0)),line((95,0),(525,700))])}
    shapes.update({name(c):spec for c,spec in design.items()})
    for g,(w,paths) in shapes.items():
        pen=TTGlyphPen(None)
        for p in paths:
            if isinstance(p,tuple) and p[0]=='dot':
                x,y,r=p[1];contour(pen,ellipse(x,y,r*stroke/52,r*stroke/52),True)
            elif isinstance(p,tuple) and p[0]=='closed':expand(pen,p[1],stroke/2,True)
            else:expand(pen,p,stroke/2)
        glyph=pen.glyph()
        # Overlapping strokes use nonzero fill; the flag is explicit for rasterizers.
        if glyph.numberOfContours>0:
            glyph.flags[0]|=0x40
        glyphs[g]=glyph
        metrics[g]=(w,0)
    fb.setupGlyf(glyphs)
    # Accurate bearings preserve drawn coordinates in FreeType/CoreText.
    for g in glyphs:
        glyphs[g].recalcBounds(fb.font['glyf']);metrics[g]=(metrics[g][0],getattr(glyphs[g],'xMin',0))
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=1020,descent=-280,lineGap=0)
    fb.setupCharacterMap({ord(c):name(c) for c in design})
    fb.setupNameTable({'familyName':'Hane Sans' if style=='Regular' else 'Hane Sans '+style,
      'styleName':'Regular','uniqueFontIdentifier':f'HaneSans-0.100-{style}',
      'fullName':f'Hane Sans {style}','psName':f'HaneSans-{style}','version':'Version 0.100',
      'typographicFamily':'Hane Sans','typographicSubfamily':style,
      'manufacturer':'Hane','designer':'Hane / Lucas Frischeisen',
      'description':'Original soft geometric typeface for Hane. Prototype 0.1. Latin script.'})
    fb.setupOS2(version=4,sTypoAscender=1020,sTypoDescender=-280,sTypoLineGap=0,usWinAscent=1050,usWinDescent=290,
                usWeightClass=weight,fsType=0,sxHeight=500,sCapHeight=700,
                fsSelection=0x40|0x80)
    fb.setupPost();fb.setupMaxp();fb.font['head'].fontRevision=0.1
    pairs={'AV':-75,'AW':-55,'AY':-75,'AT':-50,'TA':-50,'To':-55,'Ta':-55,'Te':-55,'Tr':-35,
           'Ty':-30,'Va':-45,'Vo':-45,'Ve':-45,'Wa':-35,'Wo':-35,'Ya':-70,'Yo':-70,'Ye':-70,
           'LT':-40,'LY':-50,'FA':-35,'Pa':-25,'Po':-25,'ry':-15,'rv':-15}
    rules='\n'.join(f'pos {name(a)} {name(b)} {v};' for (a,b),v in pairs.items())
    feature='languagesystem DFLT dflt; languagesystem latn dflt; feature kern {\n'+rules+'\n} kern;'
    addOpenTypeFeaturesFromString(fb.font,feature)
    fb.save(OUT/f'HaneSans-{style}.ttf')
    font=TTFont(OUT/f'HaneSans-{style}.ttf');font.flavor='woff2';font.save(OUT/f'HaneSans-{style}.woff2')

if __name__=='__main__':
    build('Regular',52,400);build('Medium',68,500)
    print(json.dumps({'glyphs':len(design)+1,'files':[p.name for p in OUT.glob('*')]}))
