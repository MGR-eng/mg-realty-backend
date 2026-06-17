import os, stat

SIG = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~mail/Data/V4/Signatures/2136059E-CF41-4412-B9D1-EB9858FAC4EB.mailsignature"
)

content = """Content-Transfer-Encoding: 7bit
Content-Type: text/html;
\tcharset=us-ascii
Message-Id: <AC28261A-5E34-4E06-9A49-D9CDD5CBD4B2>
Mime-Version: 1.0 (Mac OS X Mail 16.0 \\(3864.600.51.1.1\\))

<html><body>
<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;border-collapse:collapse;max-width:560px">
<tr><td colspan="3" height="2" style="background:#111111;padding:0;line-height:2px;font-size:2px" bgcolor="#111111">&nbsp;</td></tr>
<tr><td colspan="3" height="14" style="line-height:14px;font-size:14px">&nbsp;</td></tr>
<tr valign="top">
  <td style="vertical-align:middle;padding-right:18px" valign="middle">
    <img src="https://i.imgur.com/GDDL7hL.gif" width="180" height="54" alt="Logos" style="display:block;width:180px;height:54px;border:0">
  </td>
  <td style="width:1px;padding:0" width="1" valign="top">
    <table cellpadding="0" cellspacing="0" border="0">
      <tr><td width="1" height="86" style="width:1px;height:86px;background:#111111;line-height:1px;font-size:1px" bgcolor="#111111">&nbsp;</td></tr>
    </table>
  </td>
  <td style="vertical-align:top;padding-left:18px" valign="top">
    <table cellpadding="0" cellspacing="0" border="0">
      <tr><td style="font-size:18px;font-weight:700;color:#111111;padding-bottom:2px;line-height:1.2">Matt Golden</td></tr>
      <tr><td style="font-size:10px;color:#888888;text-transform:uppercase;letter-spacing:1.2px;padding-bottom:9px">Estates Director &nbsp;&bull;&nbsp; Rare Properties Inc.</td></tr>
      <tr><td style="font-size:12px;color:#555555;line-height:1.9">
        <a href="tel:+13239197539" style="color:#555555;text-decoration:none">(323) 919-7539</a>
        &nbsp;<span style="color:#bbbbbb">|</span>&nbsp;
        <a href="mailto:matt@mgoldenrealty.com" style="color:#555555;text-decoration:none">matt@mgoldenrealty.com</a><br>
        <a href="https://mgoldenrealty.com" style="color:#111111;text-decoration:none;font-weight:600">mgoldenrealty.com</a>
        &nbsp;&nbsp;&bull;&nbsp;&nbsp;
        <span style="color:#aaaaaa;font-size:11px">DRE #02130422</span>
      </td></tr>
    </table>
  </td>
</tr>
<tr><td colspan="3" height="12" style="line-height:12px;font-size:12px">&nbsp;</td></tr>
<tr><td colspan="3" height="1" style="background:#111111;padding:0;line-height:1px;font-size:1px" bgcolor="#111111">&nbsp;</td></tr>
</table>
</body></html>"""

# Unlock, write, lock
os.system(f'chflags nouchg "{SIG}"')
os.chmod(SIG, 0o644)
with open(SIG, 'w') as f:
    f.write(content)
os.system(f'chflags uchg "{SIG}"')
print(f"Done! Wrote {os.path.getsize(SIG)} bytes to signature file.")
print("Now open Apple Mail — your signature should be there.")
