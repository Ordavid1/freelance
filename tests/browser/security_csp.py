"""Run against the built local app only. Injects synthetic markup, never credentials."""
from playwright.sync_api import sync_playwright, expect
import json
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width':430,'height':900})
    config={'apiKey':'testing','authDomain':'freelance-514118.firebaseapp.com','projectId':'freelance-514118','appId':'test-app','googleSignInEnabled':True}
    page.route('**/api/config/firebase', lambda route: route.fulfill(content_type='application/json',body=json.dumps(config)))
    def injected_response(route):
        response=route.fetch()
        body=response.text().replace('</head>', '<script>window.injectedMarkup=true</script></head>')
        headers={key:value for key,value in response.headers.items() if key not in ['content-length','content-encoding']}
        route.fulfill(status=response.status,headers=headers,body=body)
    page.route('**/signin',injected_response)
    response=page.goto('http://127.0.0.1:3100/signin',wait_until='networkidle')
    assert "'strict-dynamic'" in response.headers['content-security-policy']
    expect(page.get_by_role('button',name='המשך עם Google',exact=False)).to_be_enabled()
    assert page.evaluate('window.injectedMarkup === true') is False
    browser.close()
    print('PASS CSP blocks attacker markup while Google sign-in UI hydrates normally.')
