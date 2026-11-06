#!/bin/bash
# Pages the Safety Line reviewer by SMS and email through the backend container.
# The backend already holds the reviewer contacts and the SMS and email provider
# settings, so nothing secret lives in this script.
# Install on the VPS: copy to /usr/local/bin/drift-alert.sh and make it executable.
# usage: drift-alert.sh "subject" "body"
docker exec traveller-backend node -e 'require("/app/dist/services/notifications").sendReviewerAlert({subject:process.argv[1],body:process.argv[2],urgent:true}).then(function(){process.exit(0)}).catch(function(e){console.error(e);process.exit(1)})' "$1" "$2"
