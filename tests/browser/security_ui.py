from playwright.sync_api import sync_playwright, expect
import json
ID='a'*64
state={'blocked':False,'restricted':False,'sends':0,'appeals':0}
def api(route):
 req=route.request; url=req.url; method=req.method
 if '/api/auth/session' in url: data={'user':{'uid':'one','name':'משתמש בדיקה','email':'test@example.test','picture':None}}
 elif '/api/marketplace/safety' in url:
  if method=='POST':state['blocked']=req.post_data_json['blocked'];data={'ok':True}
  else:data={'state':'restricted' if state['restricted'] else 'active','blockedByMe':state['blocked'],'canContact':not state['blocked'] and not state['restricted']}
 elif '/api/marketplace/appeals' in url:state['appeals']+=1;data={'ok':True,'id':'review-test-123'}
 elif '/api/marketplace/conversations' in url:
  if method=='POST':state['sends']+=1;data={'ok':True}
  elif '?id=' in url:data={'messages':[{'id':'m1','senderUid':'two','senderName':'דנה לדוגמה','text':'אפשר לתאם שיחה קצרה לגבי היקף העבודה?'}]}
  else:data={'conversations':[{'id':ID,'clientUid':'two','freelancerUid':'one','clientName':'דנה לדוגמה','freelancerName':'משתמש בדיקה','projectTitle':'פרויקט בדיקה','lastMessage':'שיחת בדיקה בלבד'}]}
 else:data={}
 route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':430,'height':900},device_scale_factor=1.5)
 page.route('**/api/**',api)
 page.goto('http://127.0.0.1:3100/messages?conversation='+ID,wait_until='networkidle')
 entry=page.get_by_role('textbox',name='הודעה',exact=True);expect(entry).to_be_enabled()
 expect(page.get_by_role('button',name='דיווח',exact=True)).to_have_count(0)
 page.get_by_role('button',name='חסימת קשר',exact=True).click()
 dialog=page.get_by_role('dialog');expect(dialog).to_be_visible()
 page.screenshot(path='docs/security-preview/block-mobile.png',full_page=True)
 dialog.get_by_role('button',name='אישור חסימה',exact=True).click();expect(entry).to_be_disabled()
 page.get_by_role('button',name='הסרת החסימה שלי',exact=True).click()
 dialog.get_by_role('button',name='אישור הסרת החסימה',exact=True).click();expect(entry).to_be_enabled()
 for text in ['הודעת בדיקה ראשונה','הודעת בדיקה שנייה']:
  entry.fill(text);page.get_by_role('button',name='שליחה',exact=True).click();expect(entry).to_have_value('');expect(entry).to_be_enabled()
 assert state['sends']==2
 state['restricted']=True
 page.reload(wait_until='networkidle')
 expect(page.get_by_text('חלק מפעולות החשבון הוגבלו',exact=True)).to_be_visible();expect(entry).to_be_disabled()
 page.get_by_role('button',name='בקשה לבדיקה נוספת',exact=True).click()
 page.get_by_role('textbox',name='מה תרצו שנבדוק?',exact=True).fill('אבקש לבדוק שוב את הגבלת החשבון שלי.')
 page.screenshot(path='docs/security-preview/restriction-mobile.png',full_page=True)
 page.get_by_role('button',name='שליחת בקשה',exact=True).click()
 expect(page.get_by_text('הבקשה התקבלה. מספר הפנייה: review-test-123',exact=True)).to_be_visible()
 assert state['appeals']==1
 expect(page.get_by_role('link',name='ניהול חברות',exact=True)).to_have_attribute('href','/membership')
 browser.close()
 print('PASS mobile block/unblock confirmation, repeat sends, restriction, appeal and membership link. Synthetic API fixtures only.')
