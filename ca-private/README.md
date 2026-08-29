# NEVER commit this directory's contents anywhere public, and never bundle it into the packaged app.
#
# ca.key is the private key for the "TeXeR PPT Local CA" root certificate that install/Install-TeXeR-PPT.ps1 imports into each user's CurrentUser
# Trusted Root store. Anyone who obtains ca.key could mint additional certificates that every machine running this add-in would silently trust.
# Keep it offline. It is only needed to reissue app/certs/localhost.crt before it expires (see EXPIRY below) or to add another SAN.
#
# Regenerate everything with:
#   openssl req -x509 -new -nodes -newkey rsa:2048 -keyout ca.key -out ../app/certs/ca.crt -days 3650 -config ca.cnf
#   openssl req -new -nodes -newkey rsa:2048 -keyout ../app/certs/localhost.key -out localhost.csr -config localhost.cnf
#   openssl x509 -req -in localhost.csr -CA ../app/certs/ca.crt -CAkey ca.key -CAcreateserial -out ../app/certs/localhost.crt -days 1825 -extensions v3_req -extfile localhost.cnf
#   rm localhost.csr ca.srl
#
# EXPIRY:
#   ca.crt         valid until 2036-08-26
#   localhost.crt  valid until 2031-08-28  <- reissue before this date
