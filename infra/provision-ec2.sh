#!/usr/bin/env bash
set -euo pipefail

# Provision a small EC2 instance suitable for running the space-ship-socket server.
# Requirements:
#  - AWS CLI v2 configured with credentials that can create EC2 resources
#  - jq installed (optional; only used for pretty output)
#
# This script is idempotent-ish: it will reuse existing key pair / security group if names match.
# Review before running in production. Designed for a low-cost t4g.small / t3.small style instance.

REGION=${REGION:-${AWS_REGION:-us-east-1}}
KEY_NAME=${KEY_NAME:-space-ship-socket-key}
SEC_GROUP_NAME=${SEC_GROUP_NAME:-space-ship-socket-sg}
INSTANCE_NAME_TAG=${INSTANCE_NAME_TAG:-space-ship-socket}
INSTANCE_TYPE=${INSTANCE_TYPE:-t3.small}
# Amazon Linux 2023 AMI (x86_64) – this ID changes over time; we resolve latest via SSM parameter.
AMI_ID=$(aws ssm get-parameter --region "$REGION" --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64 --query Parameter.Value --output text)

echo "Using AMI: $AMI_ID"

if ! aws ec2 describe-key-pairs --region "$REGION" --key-names "$KEY_NAME" >/dev/null 2>&1; then
  echo "Creating key pair $KEY_NAME"
  aws ec2 create-key-pair --region "$REGION" --key-name "$KEY_NAME" --query 'KeyMaterial' --output text > ${KEY_NAME}.pem
  chmod 600 ${KEY_NAME}.pem
  echo "Saved private key to ${KEY_NAME}.pem (store securely; add to GitHub secret EC2_SSH_KEY)"
else
  echo "Key pair $KEY_NAME already exists (not exporting private key)."
fi

# Security group
SG_ID=$(aws ec2 describe-security-groups --region "$REGION" --group-names "$SEC_GROUP_NAME" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [[ -z "$SG_ID" || "$SG_ID" == "None" ]]; then
  echo "Creating security group $SEC_GROUP_NAME"
  SG_ID=$(aws ec2 create-security-group --region "$REGION" --group-name "$SEC_GROUP_NAME" --description "Space Ship Socket SG" --query 'GroupId' --output text)
  # Allow SSH (22) from your IP and WebSocket (8080) from anywhere (adjust as needed)
  MY_IP=$(curl -s https://checkip.amazonaws.com || echo "0.0.0.0")
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" --protocol tcp --port 22 --cidr ${MY_IP%$'\n'}/32 || true
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" --ip-permissions 'IpProtocol=tcp,FromPort=8080,ToPort=8080,IpRanges=[{CidrIp=0.0.0.0/0}]' || true
else
  echo "Reusing security group $SEC_GROUP_NAME ($SG_ID)"
fi

# Check for an existing running instance with the Name tag
EXISTING_INSTANCE_ID=$(aws ec2 describe-instances --region "$REGION" --filters "Name=tag:Name,Values=$INSTANCE_NAME_TAG" "Name=instance-state-name,Values=running" --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)
if [[ -n "$EXISTING_INSTANCE_ID" && "$EXISTING_INSTANCE_ID" != "None" ]]; then
  echo "Found existing running instance: $EXISTING_INSTANCE_ID (skipping creation)"
  INSTANCE_ID=$EXISTING_INSTANCE_ID
else
  echo "Launching new instance"
  INSTANCE_ID=$(aws ec2 run-instances \
    --region "$REGION" \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME_TAG}]" \
    --user-data file://infra/user-data.sh \
    --query 'Instances[0].InstanceId' --output text)
  echo "Instance ID: $INSTANCE_ID"
  echo "Waiting for running state..."
  aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
fi

PUBLIC_DNS=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].PublicDnsName' --output text)
PUBLIC_IP=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

echo "Instance is up: $INSTANCE_ID"
echo "Public DNS: $PUBLIC_DNS"
echo "Public IP:  $PUBLIC_IP"
echo
echo "Next steps:"
echo "  1. Store the contents of ${KEY_NAME}.pem as GitHub secret EC2_SSH_KEY (if newly created)."
echo "  2. Add AWS credentials & region as secrets (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)."
echo "  3. Push to master to trigger deployment workflow."
