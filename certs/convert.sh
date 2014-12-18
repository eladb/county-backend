#!/bin/bash
#  1. Request a certificate through the Apple Developer website and install it into your Keychain.
#  2. Go to Keychain Access, under "Keys", locate the private key (it should have the cert under it)
#  3. Select the private key and go to File -> Export.
#  4. Export the .p12 file into this directory under `Certificates.p12` (no password)
#  5. Save the output to your favorite .pem file. It should contain the cert and the private key.
openssl pkcs12 -in Certificates.p12 -clcerts -nodes
